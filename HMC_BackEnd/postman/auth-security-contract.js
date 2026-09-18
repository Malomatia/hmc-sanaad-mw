const fs = require('node:fs');
const path = require('node:path');

const context = { username: '{{username}}', deviceid: '{{deviceid}}', platform: '{{platform}}' };
const generic = 'If eligible, a verification code will be sent to your registered contact.';
const variables = ['username', 'deviceid', 'mpin', 'newmpin', 'otp', 'resetotp', 'requestid',
  'resetrequestid', 'enrollmenttoken', 'enrollmentexpiresat', 'token', 'refreshtoken'];
const secrets = new Set(['mpin', 'newmpin', 'otp', 'resetotp', 'enrollmenttoken', 'token', 'refreshtoken']);
const helper = [
  'function save(key, value) {',
  '  pm.collectionVariables.set(key, value);',
  '  if (pm.environment.name) pm.environment.set(key, value);',
  '}',
];
const jsonBody = (value) => ({ mode: 'raw', raw: JSON.stringify(value, null, 2), options: { raw: { language: 'json' } } });
const script = (listen, exec) => ({ listen, script: { type: 'text/javascript', exec } });
const routeOf = (item) => typeof item.request?.url === 'string'
  ? item.request.url.replace(/^\{\{baseUrl\}\}\//, '').split('?')[0]
  : (item.request?.url?.path ?? []).join('/');

const specs = [
  { route: 'auth/initiate', body: context, require: ['username', 'deviceid'], clear: ['requestid', 'enrollmenttoken', 'enrollmentexpiresat'],
    capture: { requestid: 'requestid' }, example: { status: 'success', message: generic, requestid: '<opaque-request-id>' },
    description: 'Begin first registration. Response is generic for existing, new and unknown users: no employee identity, contact, registration flags or OTP channel. A real challenge is issued only for eligible first enrollment. Enter the delivered OTP into the otp variable, then validate it. requestid is opaque, not SeqNo. Do not use this route to discover account existence.' },
  { route: 'auth/send-otp', body: context, require: ['username', 'deviceid'], clear: ['requestid', 'enrollmenttoken', 'enrollmentexpiresat'],
    capture: { requestid: 'requestid' }, example: { status: 'success', message: generic, requestid: '<opaque-request-id>' },
    description: 'Registration resend, sharing the initiate rate budget. Contact destinations come exclusively from the directory; do not submit phonenumber/email. For recovery use auth/mpin/forgot instead. A new challenge supersedes older same-purpose challenges; use the latest returned requestid. A 429 response includes Retry-After.' },
  { route: 'auth/otp/validate', body: { ...context, otp: '{{otp}}', requestid: '{{requestid}}' },
    require: ['username', 'deviceid', 'otp', 'requestid'], clear: ['enrollmenttoken', 'enrollmentexpiresat'],
    capture: { enrollmenttoken: 'enrollmenttoken' },
    example: { status: 'success', message: 'OTP Validated successfully', enrollmenttoken: '<opaque-single-use-token>', expiresinseconds: 300 },
    description: 'Consumes an ONBOARDING OTP only and returns a single-use enrollmenttoken valid for 300 seconds. The script saves it for MPIN enrollment. Recovery OTPs must NOT be validated here. Invalid OTP is HTTP 200 with status=error; limits return 429. Never use enrollmenttoken as a bearer access token.' },
  { route: 'auth/mpin/update', body: { ...context, mpin: '{{mpin}}', enrollmenttoken: '{{enrollmenttoken}}' },
    require: ['username', 'deviceid', 'mpin', 'enrollmenttoken'],
    example: { status: 'success', message: 'MPIN updated successfully' },
    description: 'First enrollment only. Supply the unchanged client-hashed MPIN plus enrollmenttoken from successful OTP validation. Proof must match the user/device, be unexpired and unused. Cannot overwrite an existing MPIN. Missing/malformed proof returns 400; invalid/expired/consumed proof returns status=error. The script clears proof after this request; obtain new proof if needed.' },
  { route: 'auth/login', body: { ...context, mpin: '{{mpin}}' }, require: ['username', 'deviceid', 'mpin'], clear: ['token', 'refreshtoken'],
    capture: { token: 'token', refreshtoken: 'refreshtoken' },
    example: { status: 'success', token: '<access-jwt>', tokenType: 'Bearer', expiresIn: '1h', refreshtoken: '<refresh-jwt>' },
    description: 'Requires an active employee/device and the existing client-hashed MPIN. Saves both tokens. Tokens now carry issuer, audience, explicit type, expiration, session ID and token ID. Earlier tokens require a new login. Failed login remains HTTP 200 with status=error. JWTs are not encrypted; do not log or export real credentials.' },
  { route: 'auth/mpin/forgot', body: context, require: ['username', 'deviceid'], clear: ['resetrequestid'],
    capture: { resetrequestid: 'requestid' }, example: { status: 'initiated successfully', requestid: '<opaque-recovery-request-id>', message: generic },
    description: 'Begin recovery. Always returns a generic initiation response. Eligible registered users receive an OTP at their directory contact. Saves resetrequestid separately from enrollment requestid. Enter the code into resetotp and the new client hash into newmpin, then call auth/mpin/update/reset directly.' },
  { route: 'auth/mpin/update/reset', body: { ...context, newmpin: '{{newmpin}}', otp: '{{resetotp}}', requestid: '{{resetrequestid}}' },
    require: ['username', 'deviceid', 'newmpin', 'resetotp', 'resetrequestid'],
    example: { status: 'success', message: 'MPIN Changed successfully' },
    description: 'Consumes a FORGOT_MPIN OTP and changes the MPIN of an existing active registration. Do not call auth/otp/validate beforehand. newmpin is the unchanged client-hashed value, not restricted to numeric characters. Successful reset revokes all sessions for this username; sign in again. Invalid OTP remains HTTP 200 with status=error.' },
  { route: 'auth/token/refresh', body: { refreshtoken: '{{refreshtoken}}' }, require: ['refreshtoken'],
    capture: { token: 'token', refreshtoken: 'refreshtoken' },
    example: { status: 'success', token: '<new-access-jwt>', tokenType: 'Bearer', expiresIn: '1h', refreshtoken: '<new-refresh-jwt>' },
    description: 'Single-use refresh rotation. Saves both replacement tokens; serialize refresh calls. Reusing a rotated token revokes its session family. Account/device eligibility and functions are rechecked. Invalid sessions return status=error; database outages are errors, never authentication bypasses. Do not blindly retry an old refresh token after an ambiguous timeout.' },
  { route: 'auth/logout', body: { refreshtoken: '{{refreshtoken}}' }, require: ['token'], bearer: true,
    example: { status: 'success', message: 'Logged out successfully.' },
    description: 'Bearer access token required. Revokes the entire current session family even when refreshtoken is omitted. The script clears both local tokens after success. An invalid/expired access token requires re-login or the agreed recovery flow.' },
];

function applyAuthSecurity(collection) {
  const auth = collection.item.find((item) => item.name === 'Auth');
  if (!auth) throw new Error('Auth folder not found; refusing to rewrite another collection.');
  collection.variable ??= [];
  for (const key of [...variables, 'platform']) {
    if (!collection.variable.some((variable) => variable.key === key)) {
      collection.variable.push({ key, value: key === 'platform' ? 'Android' : '', type: 'string' });
    }
  }
  auth.description = 'Security-aware authentication contracts. Use dedicated authorized UAT accounts, apply tools/auth-security-schema.sql through the DBA first, and deploy backend/gateway together. Do not run this folder wholesale: registration/recovery send OTPs and MPIN operations mutate credentials. Run the chosen journey manually and enter its delivered OTP. Android/iOS must implement enrollmenttoken. Legacy saved captures are retained and labeled historical; they are NOT the new contract. Normal signing and state checks require AUTH_DISABLED=false and AUTH_STATIC_LOGIN=false.';
  for (const spec of specs) {
    let item = auth.item.find((candidate) => routeOf(candidate) === spec.route);
    if (!item) {
      item = { name: `POST /${spec.route}`, request: { method: 'POST', header: [{ key: 'Content-Type', value: 'application/json' }],
        url: { raw: `{{baseUrl}}/${spec.route}`, host: ['{{baseUrl}}'], path: spec.route.split('/') } }, response: [] };
      auth.item.push(item);
    }
    item.request.auth = spec.bearer ? { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] } : { type: 'noauth' };
    item.request.body = jsonBody(spec.body);
    item.request.description = `${spec.description}\n\nExamples labeled Expected are contract fixtures, not live verification. Keep {{baseUrl}} as the existing /api/v1 URL. Retained legacy response examples below are historical only.`;
    const pre = [...helper, ...spec.require.flatMap((key) => [
      `if (!pm.variables.get('${key}') || String(pm.variables.get('${key}')).includes('{{')) throw new Error('Set ${key} before sending this request.');`,
    ]), ...(spec.clear ?? []).map((key) => `save('${key}', '');`)];
    if (spec.route === 'auth/mpin/update') {
      pre.push("if (!/^[A-Za-z0-9_-]{43}$/.test(pm.variables.get('enrollmenttoken'))) throw new Error('Obtain enrollmenttoken from OTP validation first.');");
      pre.push("if (Number(pm.variables.get('enrollmentexpiresat')) <= Date.now()) throw new Error('Enrollment proof expired; verify a new OTP.');");
    }
    const success = spec.example.status;
    const test = [...helper, "pm.test('HTTP 200', () => pm.response.to.have.status(200));", 'const body = pm.response.json();',
      `pm.test('Business success', () => pm.expect(body.status).to.eql('${success}'));`,
      `if (pm.response.code === 200 && body.status === '${success}') {`];
    for (const [key, field] of Object.entries(spec.capture ?? {})) {
      test.push(`  if (typeof body.${field} === 'string' && body.${field}) save('${key}', body.${field});`);
    }
    if (spec.route === 'auth/otp/validate') {
      test.push("  pm.test('Enrollment proof present', () => pm.expect(body.enrollmenttoken).to.match(/^[A-Za-z0-9_-]{43}$/));");
      test.push("  if (Number.isFinite(body.expiresinseconds)) save('enrollmentexpiresat', String(Date.now() + body.expiresinseconds * 1000));");
    }
    if (['auth/initiate', 'auth/send-otp'].includes(spec.route)) {
      test.push("  pm.test('No pre-auth identity disclosure', () => ['employeeusername','employeename','employeenumber','email','emailunmasked','employeephonenumber','employeephonenumberunmasked','department','jobname','newuser','vflag','employeeflag','devicestatus'].forEach(key => pm.expect(body).not.to.have.property(key)));");
    }
    if (['auth/logout', 'auth/mpin/update/reset'].includes(spec.route)) {
      test.push("  save('token', ''); save('refreshtoken', '');");
    }
    test.push('}');
    if (spec.route === 'auth/token/refresh') {
      test.push("if (pm.response.code === 401 || (pm.response.code === 200 && body.status === 'error')) { save('token', ''); save('refreshtoken', ''); }");
    }
    if (spec.route === 'auth/mpin/update') test.push("save('enrollmenttoken', ''); save('enrollmentexpiresat', '');");
    item.event = [script('prerequest', pre), script('test', test)];
    const expectedName = 'Expected — hardened authentication contract (not live-tested)';
    item.response = (item.response ?? []).filter((response) => response.name !== expectedName).map((response) => ({
      ...response, name: response.name.startsWith('Historical — ') ? response.name : `Historical — ${response.name}`,
    }));
    item.response.unshift({ name: expectedName, originalRequest: structuredClone(item.request), status: 'OK', code: 200,
      _postman_previewlanguage: 'json', header: [{ key: 'Content-Type', value: 'application/json' }], cookie: [],
      body: JSON.stringify(spec.example, null, 2) });
  }
  const checkFolder = { name: 'Auth security negative checks', description: 'Run individually with authorized UAT fixtures. No OTP sending or successful writes are expected. Device-attestation headers may also be required by the deployment.', item: [
    { name: 'Missing enrollment proof must fail before MPIN write', request: { method: 'POST', auth: { type: 'noauth' },
      header: [{ key: 'Content-Type', value: 'application/json' }], url: { raw: '{{baseUrl}}/auth/mpin/update', host: ['{{baseUrl}}'], path: ['auth', 'mpin', 'update'] },
      body: jsonBody({ ...context, mpin: '{{mpin}}' }) },
      event: [script('test', ["pm.test('Missing enrollment proof rejected', () => pm.response.to.have.status(400));"])] },
    { name: 'Refresh token must not authorize protected APIs', request: { method: 'GET',
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{refreshtoken}}', type: 'string' }] }, header: [],
      url: { raw: '{{baseUrl}}/auth/me', host: ['{{baseUrl}}'], path: ['auth', 'me'] } },
      event: [script('test', ["pm.test('Refresh-as-access rejected', () => pm.response.to.have.status(401));"])] },
  ] };
  const old = collection.item.findIndex((item) => item.name === checkFolder.name);
  if (old < 0) collection.item.push(checkFolder);
  else collection.item[old] = checkFolder;
  return collection;
}

function applyAuthEnvironment(environment) {
  for (const key of [...variables, 'platform']) {
    if (!environment.values.some((value) => value.key === key)) {
      environment.values.push({ key, value: key === 'platform' ? 'Android' : '',
        type: secrets.has(key) ? 'secret' : 'default', enabled: true });
    }
  }
  return environment;
}

module.exports = { applyAuthSecurity, applyAuthEnvironment };

if (require.main === module) {
  const collectionPath = path.join(__dirname, 'HMC-Sanaad-Full.postman_collection.json');
  const environmentPath = path.join(__dirname, 'HMC-Sanaad-Full.postman_environment.json');
  const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));
  const environment = JSON.parse(fs.readFileSync(environmentPath, 'utf8'));
  fs.writeFileSync(collectionPath, JSON.stringify(applyAuthSecurity(collection), null, 2) + '\n');
  fs.writeFileSync(environmentPath, JSON.stringify(applyAuthEnvironment(environment), null, 2) + '\n');
  console.log('Updated Auth contracts and negative checks; unrelated requests and historical captures preserved. No API requests made.');
}
