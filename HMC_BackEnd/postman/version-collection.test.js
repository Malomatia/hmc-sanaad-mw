const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  buildVersionedCollection,
  validateCollection,
  requests,
  findRoute,
  rewriteUrl,
  rewriteLinks,
  sessionScript,
  v2BaseScript,
} = require('./version-collection');
const { loadBackendCatalog } = require('./backend-catalog');

const copy = (value) => JSON.parse(JSON.stringify(value));
function makeSource() {
  const url = {
    raw: '{{baseUrl}}/profile?username=ALICE&person_id=12&lang=ar',
    host: ['{{baseUrl}}'],
    path: ['profile'],
    query: [
      { key: 'username', value: 'ALICE' },
      { key: 'person_id', value: '12' },
      { key: 'lang', value: 'ar' },
    ],
  };
  return {
    info: {
      name: 'collection',
      _postman_id: 'keep-this-id',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:443/api/v1' },
      { key: 'token', value: '' },
    ],
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
    item: [
      {
        name: 'Profile',
        item: [
          {
            name: 'GET /profile',
            request: { method: 'GET', url, description: 'captured business notes' },
            event: [
              {
                listen: 'test',
                script: {
                  type: 'text/javascript',
                  exec: ['pm.test("preserved", function () {});'],
                },
              },
            ],
            response: [
              {
                name: 'Captured success',
                code: 200,
                originalRequest: { method: 'GET', url: copy(url) },
                body: JSON.stringify({ url: '/api/v1/approvals/attachments/4' }),
              },
              {
                name: 'Missing username',
                code: 400,
                originalRequest: { method: 'GET', url: copy(url) },
                body: JSON.stringify({ errors: { details: ['username must not be empty'] } }),
              },
            ],
          },
        ],
      },
      {
        name: 'Auth',
        item: [
          {
            name: 'POST /auth/login',
            request: {
              method: 'POST',
              auth: { type: 'noauth' },
              url: {
                raw: '{{baseUrl}}/auth/login',
                host: ['{{baseUrl}}'],
                path: ['auth', 'login'],
              },
              body: {
                mode: 'raw',
                raw: '{"username":"ALICE","mpin":"opaque+/=","person_id":"body-business-field"}',
              },
            },
            response: [],
          },
        ],
      },
    ],
  };
}
function makeCatalog() {
  return {
    document: { components: { schemas: {} } },
    routes: ['1', '2'].flatMap((version) => [
      {
        version,
        method: 'GET',
        path: '/profile',
        public: false,
        status: 200,
        operation: { parameters: [{ in: 'query', name: 'lang' }] },
      },
      { version, method: 'POST', path: '/auth/login', public: true, status: 200, operation: {} },
      {
        version,
        method: 'GET',
        path: '/health/ready',
        public: true,
        status: 200,
        operation: {
          summary: 'readiness',
          responses: {
            200: { content: { 'application/json': { example: { ready: true, status: 'ready' } } } },
          },
        },
      },
    ]),
  };
}

test('moves original requests unchanged into v1, fills missing routes, and adds v2 siblings', () => {
  const source = makeSource();
  const before = copy(source);
  const catalog = makeCatalog();
  const result = buildVersionedCollection(source, catalog);
  assert.deepEqual(source, before);
  assert.deepEqual(
    result.item.map((item) => item.name),
    ['v1', 'v2'],
  );
  assert.equal(result.info._postman_id, before.info._postman_id);
  for (const original of requests(before.item)) {
    const preserved = [...requests(result.item[0].item)].find(
      ({ item }) => item.name === original.item.name,
    );
    assert.deepEqual(preserved.item, original.item);
  }
  assert.equal([...requests(result.item[0].item)].length, 3);
  assert.equal([...requests(result.item[1].item)].length, 3);
  validateCollection(result, catalog);
  assert.deepEqual(buildVersionedCollection(result, catalog), result);
});

test('v2 removes only identity queries and preserves authentication bodies and scripts', () => {
  const source = makeSource();
  const result = buildVersionedCollection(source, makeCatalog());
  const entries = [...requests(result.item[1].item)].map(({ item }) => item);
  const profile = entries.find((item) => item.name === 'GET /profile');
  assert.equal(profile.request.url.raw, '{{baseUrlV2}}/profile?lang=ar');
  assert.deepEqual(profile.request.url.host, ['{{baseUrlV2}}']);
  assert.deepEqual(profile.request.url.query, [{ key: 'lang', value: 'ar' }]);
  assert.deepEqual(profile.event, source.item[0].item[0].event);
  assert.equal(profile.response[0].originalRequest.url.raw, '{{baseUrlV2}}/profile?lang=ar');
  assert.equal(JSON.parse(profile.response[0].body).url, '/api/v2/approvals/attachments/4');
  assert.match(profile.response[0].name, /not captured/);
  assert.match(profile.response[1].originalRequest.url.raw, /username=ALICE/);
  assert.match(profile.response[1].body, /Identity query parameters are not accepted/);
  const login = entries.find((item) => item.name === 'POST /auth/login');
  assert.deepEqual(login.request.body, source.item[1].item[0].request.body);
  assert.equal(login.request.auth.type, 'noauth');
});

test('raw URLs retain business encoding, templates and fragments while rejecting identity aliases', () => {
  const raw =
    '{{baseUrl}}/schools?search=hello%20world&%75sername=x&enum[]=1&user_name=x&person_id=7&page={{page}}#section';
  assert.equal(
    rewriteUrl(raw, true),
    '{{baseUrlV2}}/schools?search=hello%20world&page={{page}}#section',
  );
  assert.equal(rewriteUrl(raw, false), raw.replace('{{baseUrl}}', '{{baseUrlV2}}'));
});

test('public administrative username filters remain available in v2', () => {
  const source = makeSource();
  const catalog = makeCatalog();
  for (const route of catalog.routes) if (route.path === '/profile') route.public = true;
  const result = buildVersionedCollection(source, catalog);
  const profile = [...requests(result.item[1].item)].find(
    ({ item }) => item.name === 'GET /profile',
  ).item;
  assert.match(profile.request.url.raw, /username=ALICE/);
  assert.equal(profile.request.auth.type, 'noauth');
  validateCollection(result, catalog);
});

function scope(values = {}) {
  const map = new Map(Object.entries(values));
  return { get: (key) => map.get(key), set: (key, value) => map.set(key, value) };
}
function sandbox(baseUrl, override) {
  const collection = scope({
    baseUrl: 'http://localhost:443/api/v1',
    baseUrlV2: '',
    token: '',
    refreshtoken: '',
  });
  const environment = scope({ baseUrl, token: '', ...(override ? { baseUrlV2: override } : {}) });
  const local = scope();
  const pm = {
    collectionVariables: collection,
    environment,
    globals: scope(),
    iterationData: scope(),
    variables: {
      get: (key) => local.get(key) ?? environment.get(key) ?? collection.get(key),
      set: local.set,
      replaceIn: (value) =>
        value.replace(
          /\{\{([^}]+)\}\}/g,
          (_, key) => environment.get(key) ?? collection.get(key) ?? '',
        ),
    },
    request: { url: { getPath: () => '/auth/login' } },
    response: {
      code: 200,
      json: () => ({ status: 'success', token: 'access-test', refreshtoken: 'refresh-test' }),
    },
  };
  return { pm, local, collection, environment };
}

test('v2 base derives from the selected environment and supports explicit overrides and neutral prefixes', () => {
  for (const [base, explicit, expected] of [
    ['https://backend.example/api/v1/', undefined, 'https://backend.example/api/v2'],
    ['https://backend.example/custom/v1', undefined, 'https://backend.example/custom/v2'],
    ['https://backend.example/legacy', undefined, 'https://backend.example/legacy/v2'],
    [
      'https://gateway.example/api/v1',
      'https://backend.example/api/v2/',
      'https://backend.example/api/v2',
    ],
  ]) {
    const fixture = sandbox(base, explicit);
    fixture.local.set('baseUrlV2', 'https://stale.example/api/v2');
    fixture.pm.globals.set('baseUrlV2', 'https://ignored.example/api/v2');
    vm.runInNewContext(v2BaseScript.join('\n'), { pm: fixture.pm });
    assert.equal(fixture.local.get('baseUrlV2'), expected);
    assert.equal(fixture.environment.get('baseUrl'), base);
  }
});

test('login and refresh scripts save both tokens without an empty environment token shadowing them', () => {
  for (const endpoint of ['/auth/login', '/api/v2/auth/token/refresh']) {
    const fixture = sandbox('https://backend.example/api/v1');
    fixture.pm.request.url.getPath = () => endpoint;
    vm.runInNewContext(sessionScript.join('\n'), { pm: fixture.pm });
    assert.equal(fixture.collection.get('token'), 'access-test');
    assert.equal(fixture.environment.get('token'), 'access-test');
    assert.equal(fixture.collection.get('refreshtoken'), 'refresh-test');
  }
  const failure = sandbox('https://backend.example/api/v1');
  failure.pm.response.json = () => ({ status: 'error', token: 'do-not-save' });
  vm.runInNewContext(sessionScript.join('\n'), { pm: failure.pm });
  assert.equal(failure.collection.get('token'), '');
});

test('legacy generation delegates existing collections instead of overwriting curated requests', () => {
  const stopped = new Error('expected exit');
  const calls = [];
  assert.throws(
    () =>
      vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, 'generate-full-collection.js'), 'utf8'),
        {
          __dirname,
          require: (name) => {
            if (name === 'fs') return { existsSync: () => true };
            if (name === 'path') return path;
            if (name === 'node:child_process')
              return {
                spawnSync: (...args) => {
                  calls.push(args);
                  return { status: 0 };
                },
              };
            throw new Error(`Unexpected bootstrap import ${name}`);
          },
          process: {
            execPath: 'node',
            argv: ['node', 'generator', '--check'],
            exit: (code) => {
              assert.equal(code, 0);
              throw stopped;
            },
          },
        },
      ),
    (error) => error === stopped,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'node');
  assert.deepEqual(Array.from(calls[0][1]), [
    path.join(__dirname, 'version-collection.js'),
    '--check',
  ]);
});

test('Swagger sync recursively matches each version without mixing examples', () => {
  const entry = (version) => ({
    name: 'POST /things/:id',
    request: {
      method: 'POST',
      url: {
        raw: `{{baseUrl${version === 'v2' ? 'V2' : ''}}}/things/123`,
        path: ['things', '123'],
      },
    },
    response: [{ name: 'Retained error', code: 404, body: 'keep' }],
  });
  const collection = {
    item: ['v1', 'v2'].map((name) => ({ name, item: [{ name: 'Nested', item: [entry(name)] }] })),
  };
  const operation = (version) => ({
    requestBody: { content: { 'application/json': { example: { version } } } },
    responses: {
      200: { content: { 'application/json': { example: { version, url: '/api/v1/things/123' } } } },
    },
  });
  const swagger = {
    paths: {
      '/api/v1/things/{id}': { post: operation('v1') },
      '/api/v2/things/{id}': { post: operation('v2') },
    },
  };
  let output;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'sync-from-swagger.js'), 'utf8'), {
    __dirname,
    require: (name) => {
      if (name === 'fs')
        return {
          readFileSync: () => JSON.stringify(collection),
          writeFileSync: (_file, value) => {
            output = JSON.parse(value);
          },
        };
      if (name === 'path') return path;
      if (name === './version-collection') return { rewriteLinks };
      if (name.endsWith('local-swagger.json')) return swagger;
      throw new Error(`Unexpected import ${name}`);
    },
    console: { log() {} },
  });
  for (const folder of output.item) {
    const item = folder.item[0].item[0];
    assert.equal(JSON.parse(item.request.body.raw).version, folder.name);
    assert.equal(JSON.parse(item.response[0].body).url, `/api/${folder.name}/things/123`);
    assert.equal(item.response[1].body, 'keep');
  }
});

test('real collection covers all 133 routes in both versions without losing curated v1 content', async () => {
  const source = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'HMC-Sanaad-Full.postman_collection.json'), 'utf8'),
  );
  const catalog = await loadBackendCatalog();
  const before = copy(source);
  const result = buildVersionedCollection(source, catalog);
  validateCollection(result, catalog);
  assert.deepEqual(source, before);
  const originalItems = source.item.find((item) => item.name === 'v1')?.item || source.item;
  for (const { item } of requests(originalItems)) {
    const matching = [...requests(result.item[0].item)].find(
      (entry) => entry.item.name === item.name,
    );
    assert.deepEqual(matching.item, item);
  }
  const oldNames = new Set([...requests(originalItems)].map(({ item }) => item.name));
  for (const { item } of requests(result.item[0].item)) {
    if (oldNames.has(item.name)) continue;
    const route = findRoute(
      item,
      catalog.routes.filter((r) => r.version === '1'),
    );
    const bodySchema = route.operation.requestBody?.content?.['application/json']?.schema;
    if (!bodySchema) continue;
    assert.ok(item.request.body?.raw, `Missing JSON body for ${item.name}`);
    const body = JSON.parse(item.request.body.raw);
    const schema = bodySchema.$ref
      ? catalog.document.components.schemas[bodySchema.$ref.split('/').pop()]
      : bodySchema;
    for (const key of schema.required || [])
      assert.ok(Object.hasOwn(body, key), `${item.name}: missing ${key}`);
  }
  assert.equal([...requests(result.item[0].item)].length, 133);
  assert.equal([...requests(result.item[1].item)].length, 133);
  assert.deepEqual(buildVersionedCollection(result, catalog), result);
  for (const { item } of requests(result.item[1].item)) {
    const route = findRoute(
      item,
      catalog.routes.filter((r) => r.version === '2'),
    );
    assert.ok(route);
    for (const response of item.response || []) {
      if (response.originalRequest?.url?.raw)
        assert.match(response.originalRequest.url.raw, /^\{\{baseUrlV2\}\}/);
    }
  }
  const scripts = [...result.item, ...requests(result.item).map(({ item }) => item)];
  for (const item of scripts)
    for (const event of item.event || []) {
      if (event.script?.exec) new vm.Script(event.script.exec.join('\n'));
    }
});
