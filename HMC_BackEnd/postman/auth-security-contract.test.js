const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { applyAuthSecurity, applyAuthEnvironment } = require('./auth-security-contract');

const fixture = () => ({ variable: [{ key: 'baseUrl', value: 'http://localhost:3000/api/v1' }], item: [
  { name: 'Auth', item: [
    { name: 'Old initiate', request: { method: 'POST', url: { path: ['auth', 'initiate'] } },
      response: [{ name: 'Captured legacy result', body: '{"old":"capture"}' }] },
    { name: 'Healthcheck', request: { method: 'POST', url: { path: ['healthcheck'] } }, response: [{ body: 'keep me' }] },
  ] },
  { name: 'Leave', item: [{ name: 'Curated request', request: { method: 'GET', url: 'untouched' }, response: [{ body: 'unchanged' }] }] },
] });
const itemFor = (collection, route) => collection.item[0].item.find((item) => item.request.url.path?.join('/') === route);
const exec = (item, listen, sandbox) => vm.runInNewContext(item.event.find((event) => event.listen === listen).script.exec.join('\n'), { ...sandbox });

function sandbox(body) {
  const collection = new Map([['enrollmenttoken', 'stale-collection-proof']]);
  const environment = new Map([['username', 'TESTUSER'], ['deviceid', 'test-device'], ['mpin', 'client-hash'],
    ['otp', '012345'], ['requestid', 'r'.repeat(43)], ['enrollmenttoken', 'stale-environment-proof']]);
  const scope = (map) => ({ set: (key, value) => map.set(key, value) });
  const expect = (value) => ({ to: { eql: (expected) => assert.deepEqual(value, expected), match: (regex) => assert.match(value, regex) },
    not: { to: { have: { property: (key) => assert.ok(!(key in value)) } } } });
  return { collection, environment, pm: {
    collectionVariables: scope(collection), environment: { name: 'UAT', ...scope(environment) },
    variables: { get: (key) => environment.has(key) ? environment.get(key) : collection.get(key) },
    response: { code: 200, json: () => body, to: { have: { status: (code) => assert.equal(code, 200) } } },
    expect, test: (_name, callback) => callback(),
  } };
}

test('changes only authentication contracts and preserves legacy captures as historical', () => {
  const input = fixture();
  const unrelated = structuredClone(input.item[1]);
  const health = structuredClone(input.item[0].item[1]);
  const result = applyAuthSecurity(input);
  assert.deepEqual(result.item[1], unrelated);
  assert.deepEqual(result.item[0].item[1], health);
  const initiate = itemFor(result, 'auth/initiate');
  assert.equal(initiate.response[1].name, 'Historical — Captured legacy result');
  assert.equal(initiate.response[1].body, '{"old":"capture"}');
  assert.match(initiate.response[0].name, /not live-tested/);
  assert.equal(JSON.parse(initiate.response[0].body).emailunmasked, undefined);
  assert.equal(JSON.parse(itemFor(result, 'auth/mpin/update').request.body.raw).enrollmenttoken, '{{enrollmenttoken}}');
  assert.equal(JSON.parse(itemFor(result, 'auth/mpin/update/reset').request.body.raw).requestid, '{{resetrequestid}}');
});

test('is idempotent and does not reset existing environment values', () => {
  const once = applyAuthSecurity(fixture());
  const twice = applyAuthSecurity(structuredClone(once));
  assert.deepEqual(twice, once);
  const env = { values: [{ key: 'username', value: 'fixture-user', enabled: true }] };
  applyAuthEnvironment(env);
  assert.equal(env.values[0].value, 'fixture-user');
  assert.equal(env.values.find((value) => value.key === 'enrollmenttoken').type, 'secret');
  assert.deepEqual(applyAuthEnvironment(structuredClone(env)), env);
});

test('all generated scripts compile without network calls', () => {
  const collection = applyAuthSecurity(fixture());
  for (const folder of collection.item) for (const item of folder.item ?? []) {
    for (const event of item.event ?? []) new vm.Script(event.script.exec.join('\n'));
  }
});

test('clears stale enrollment proof and captures the new proof in both variable scopes', () => {
  const collection = applyAuthSecurity(fixture());
  const otp = itemFor(collection, 'auth/otp/validate');
  const grant = 'g'.repeat(43);
  const context = sandbox({ status: 'success', enrollmenttoken: grant, expiresinseconds: 300 });
  exec(otp, 'prerequest', context);
  assert.equal(context.environment.get('enrollmenttoken'), '');
  exec(otp, 'test', context);
  assert.equal(context.environment.get('enrollmenttoken'), grant);
  assert.equal(context.collection.get('enrollmenttoken'), grant);
  assert.ok(Number(context.environment.get('enrollmentexpiresat')) > Date.now());
  const enrollment = itemFor(collection, 'auth/mpin/update');
  exec(enrollment, 'prerequest', context);
  context.environment.set('enrollmentexpiresat', '0');
  assert.throws(() => exec(enrollment, 'prerequest', context), /expired/);
});

test('stores both replacement JWTs, including overriding an existing environment token', () => {
  const collection = applyAuthSecurity(fixture());
  const context = sandbox({ status: 'success', token: 'fixture-access', refreshtoken: 'fixture-refresh' });
  context.environment.set('token', 'old-access');
  exec(itemFor(collection, 'auth/token/refresh'), 'test', context);
  assert.equal(context.environment.get('token'), 'fixture-access');
  assert.equal(context.environment.get('refreshtoken'), 'fixture-refresh');
});

test('does not reuse stale login credentials or keep tokens after definitive refresh rejection', () => {
  const collection = applyAuthSecurity(fixture());
  const context = sandbox({ status: 'error' });
  context.environment.set('token', 'old-access');
  context.environment.set('refreshtoken', 'old-refresh');
  exec(itemFor(collection, 'auth/login'), 'prerequest', context);
  assert.equal(context.environment.get('token'), '');
  assert.equal(context.environment.get('refreshtoken'), '');
  context.pm.test = () => {};
  context.environment.set('token', 'old-access');
  context.environment.set('refreshtoken', 'old-refresh');
  exec(itemFor(collection, 'auth/token/refresh'), 'test', context);
  assert.equal(context.environment.get('token'), '');
  assert.equal(context.environment.get('refreshtoken'), '');
  context.pm.response.code = 503;
  context.environment.set('token', 'existing-access');
  context.environment.set('refreshtoken', 'existing-refresh');
  exec(itemFor(collection, 'auth/token/refresh'), 'test', context);
  assert.equal(context.environment.get('token'), 'existing-access');
  assert.equal(context.environment.get('refreshtoken'), 'existing-refresh');
});

test('maintained collection and environment contain the new contract without embedded grant values', () => {
  const collection = JSON.parse(fs.readFileSync(path.join(__dirname, 'HMC-Sanaad-Full.postman_collection.json'), 'utf8'));
  const environment = JSON.parse(fs.readFileSync(path.join(__dirname, 'HMC-Sanaad-Full.postman_environment.json'), 'utf8'));
  assert.equal(JSON.parse(itemFor(collection, 'auth/mpin/update').request.body.raw).enrollmenttoken, '{{enrollmenttoken}}');
  assert.equal(environment.values.find((value) => value.key === 'enrollmenttoken').value, '');
  assert.ok(collection.item.some((folder) => folder.name === 'Auth security negative checks'));
  const description = collection.item.find((folder) => folder.name === 'Auth').description;
  assert.match(description, /No new tables or columns are required/);
  assert.match(description, /HMC_Sanad_AttestChallenge_tbl/);
  assert.doesNotMatch(description, /apply tools\/auth-security-schema/);
});
