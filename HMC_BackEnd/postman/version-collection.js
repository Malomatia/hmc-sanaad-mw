const fs = require('node:fs');
const path = require('node:path');
const { loadBackendCatalog, exampleFromSchema } = require('./backend-catalog');

const IDENTITY_QUERY = /^(username|enum|person_id|user_name)(?:$|\[)/i;
const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizePath = (value) =>
  ('/' + value.replace(/^\/+|\/+$/g, '')).replace(/\{\{[^}]+\}\}|\{[^}]+\}|:[^/]+/g, '{*}');
const keyOf = (route) => `${route.method.toUpperCase()} ${normalizePath(route.path)}`;
const decodeKey = (key) => {
  try {
    return decodeURIComponent(key.replace(/\+/g, ' '));
  } catch {
    return key;
  }
};
const sessionScript = [
  'if (pm.response.code === 200 && /\\/auth\\/(login|token\\/refresh)$/.test(pm.request.url.getPath())) {',
  '    const data = pm.response.json();',
  "    if (data.status === 'success') {",
  "        ['token', 'refreshtoken'].forEach(function (key) {",
  "            if (typeof data[key] === 'string' && data[key]) {",
  '                pm.collectionVariables.set(key, data[key]);',
  '                if (pm.environment.get(key) !== undefined) pm.environment.set(key, data[key]);',
  '            }',
  '        });',
  '    }',
  '}',
];
const v2BaseScript = [
  "const configured = [pm.iterationData, pm.environment, pm.collectionVariables, pm.globals].map(function (scope) { return scope.get('baseUrlV2'); }).find(function (value) { return value !== undefined; });",
  "const legacy = pm.variables.replaceIn(String(pm.variables.get('baseUrl') || '')).replace(/\\/+$/, '');",
  "const base = configured ? pm.variables.replaceIn(String(configured)).replace(/\\/+$/, '') : /\\/v1$/.test(legacy) ? legacy.replace(/\\/v1$/, '/v2') : legacy + '/v2';",
  "if (!/^https?:\\/\\//i.test(base)) throw new Error('Set baseUrl to the v1 API URL, or set baseUrlV2 explicitly.');",
  "pm.variables.set('baseUrlV2', base);",
];

function* requests(items, parents = []) {
  for (const item of items || []) {
    if (item.request) yield { item, parents };
    if (item.item) yield* requests(item.item, [...parents, item.name]);
  }
}

function requestPath(request) {
  if (Array.isArray(request.url?.path)) return '/' + request.url.path.join('/');
  const raw = typeof request.url === 'string' ? request.url : request.url?.raw || '';
  return (
    raw
      .split('?')[0]
      .split('#')[0]
      .replace(/^\{\{baseUrl(?:V2)?\}\}/, '')
      .replace(/^https?:\/\/[^/]+(?:\/api\/v[12])?/, '') || '/'
  );
}

function findRoute(item, routes) {
  const method = item.request.method.toUpperCase();
  const namedPath = item.name?.match(/^[A-Z]+\s+(\/\S+)/)?.[1]?.split('?')[0];
  const actual = requestPath(item.request);
  const exact = routes.find(
    (route) =>
      route.method === method &&
      [actual, namedPath]
        .filter(Boolean)
        .some((p) => normalizePath(p) === normalizePath(route.path)),
  );
  if (exact) return exact;
  return routes
    .filter((route) => route.method === method)
    .sort((a, b) => (a.path.match(/\{/g) || []).length - (b.path.match(/\{/g) || []).length)
    .find((route) => {
      const pattern = route.path
        .split('/')
        .map((part) =>
          /^\{[^}]+\}$/.test(part) ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        )
        .join('/');
      return new RegExp(`^${pattern}/?$`).test(actual);
    });
}

function rewriteLinks(value) {
  if (typeof value === 'string')
    return value.replace(/^(https?:\/\/[^/]+)?\/api\/v1(?=\/|$)/, '$1/api/v2');
  if (Array.isArray(value)) return value.map(rewriteLinks);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, rewriteLinks(child)]),
    );
  return value;
}

function rewriteUrl(url, removeIdentity) {
  const transformRaw = (raw) => {
    let value = raw.replace(/\{\{baseUrl\}\}/g, '{{baseUrlV2}}');
    value = rewriteLinks(value);
    if (!removeIdentity || !value.includes('?')) return value;
    const start = value.indexOf('?');
    const hash = value.indexOf('#', start);
    const suffix = hash < 0 ? '' : value.slice(hash);
    const query = value
      .slice(start + 1, hash < 0 ? undefined : hash)
      .split('&')
      .filter((part) => !IDENTITY_QUERY.test(decodeKey(part.split('=')[0])))
      .join('&');
    return value.slice(0, start) + (query ? '?' + query : '') + suffix;
  };
  if (typeof url === 'string') return transformRaw(url);
  const updated = clone(url);
  if (updated.raw) updated.raw = transformRaw(updated.raw);
  if (Array.isArray(updated.host))
    updated.host = updated.host.map((part) => part.replace(/\{\{baseUrl\}\}/g, '{{baseUrlV2}}'));
  if (removeIdentity && updated.query)
    updated.query = updated.query.filter((param) => !IDENTITY_QUERY.test(param.key));
  return updated;
}

function v2Description(item, route) {
  const query = [
    ...new Set([
      ...(route.operation?.parameters || [])
        .filter((param) => param.in === 'query')
        .map((param) => param.name),
      ...(item.request.url?.query || [])
        .filter((param) => route.public || !IDENTITY_QUERY.test(param.key))
        .map((param) => param.key),
    ]),
  ];
  return [
    `**API v2:** ${route.operation?.summary || item.name}`,
    `**Auth:** ${route.public ? 'Public; no bearer token required.' : 'Bearer {{token}} required, including when AUTH_DISABLED=true.'}`,
    `**Query parameters:** ${query.length ? query.join(', ') : 'None.'}`,
    route.public
      ? 'Request bodies and endpoint-specific access guards are unchanged.'
      : 'Identity comes from the verified JWT. Do not send username, enum, person_id, or user_name query parameters. A missing required employee/person claim returns 422; log in again after identity is available.',
    '**Examples:** adapted references, not new live v2 captures. Use the matching v1 request for the original captures and legacy business notes. V1 identity-query instructions do not apply to v2.',
  ].join('\n\n');
}

function copyV2(item, route) {
  const copy = clone(item);
  delete copy.id;
  copy.request.url = rewriteUrl(copy.request.url, !route.public);
  copy.request.description = v2Description(item, route);
  if (route.public) copy.request.auth = { type: 'noauth' };
  else delete copy.request.auth;
  const removed = (item.request.url?.query || []).filter((param) => IDENTITY_QUERY.test(param.key));
  if (route.status === 201)
    for (const event of copy.event || []) {
      if (event.script?.exec)
        event.script.exec = event.script.exec.map((line) =>
          line
            .replace(/Status is 200/g, 'Status is 201')
            .replace(/\.to\.have\.status\(200\)/g, '.to.have.status(201)'),
        );
    }
  for (const response of copy.response || []) {
    const created = route.status === 201 && response.code === 200;
    response.name = `V2 reference (not captured) — ${created ? response.name.replace(/\b200\b/g, '201') : response.name}`;
    if (created) {
      response.code = 201;
      response.status = 'Created';
    }
    if (response.originalRequest?.url)
      response.originalRequest.url = rewriteUrl(response.originalRequest.url, !route.public);
    if (response.originalRequest?.description)
      response.originalRequest.description = copy.request.description;
    if (response.body) {
      try {
        const body = rewriteLinks(JSON.parse(response.body));
        if (created && body?.httpStatusCode === 200) body.httpStatusCode = 201;
        response.body = JSON.stringify(body, null, 2);
      } catch {
        response.body = rewriteLinks(response.body);
      }
    }
    if (
      !route.public &&
      response.code === 400 &&
      removed.length &&
      /\b(username|enum|person_id|user_name)\b/i.test(response.name + ' ' + response.body)
    ) {
      const param = { ...removed[0], disabled: false };
      response.name = 'Identity query parameters rejected (400) — v2 example, not captured';
      response.originalRequest = clone(copy.request);
      response.originalRequest.url.query = [...(response.originalRequest.url.query || []), param];
      const raw = response.originalRequest.url.raw;
      const hash = raw.indexOf('#');
      const base = hash < 0 ? raw : raw.slice(0, hash);
      response.originalRequest.url.raw =
        base +
        (base.includes('?') ? '&' : '?') +
        `${param.key}=${encodeQueryValue(param.value)}` +
        (hash < 0 ? '' : raw.slice(hash));
      response.status = 'Bad Request';
      response.body = JSON.stringify(
        {
          success: false,
          message: 'Validation failed.',
          status: 'error',
          httpStatusCode: 400,
          errors: {
            details: ['Identity query parameters are not accepted in v2; use the access token.'],
          },
        },
        null,
        2,
      );
    }
  }
  return copy;
}

function encodeQueryValue(value) {
  return String(value ?? '')
    .split(/(\{\{[^}]+\}\})/)
    .map((part) => (/^\{\{[^}]+\}\}$/.test(part) ? part : encodeURIComponent(part)))
    .join('');
}

function extractExample(content, document) {
  if (!content) return undefined;
  if (content.examples) {
    const example = content.examples.verified || Object.values(content.examples)[0];
    if (example && example.value !== undefined) return example.value;
  }
  return content.example !== undefined
    ? content.example
    : exampleFromSchema(content.schema, document);
}

const requestOverrides = {
  'POST /diagnostics/email/test': { body: { to: '{{emailRecipient}}' } },
  'POST /dev-console/mode': { body: { enabled: false } },
  'POST /dev-console/execute': { body: { sql: 'SELECT 1 FROM DUAL', binds: {}, maxRows: 1 } },
  'POST /dev-console/explain': { body: { sql: 'SELECT 1 FROM DUAL' } },
  'POST /dev-console/api-call': { body: { method: 'GET', path: '/health/ready' } },
  'GET /dev-console/source': { query: [{ key: 'name', value: 'XXHMC_SND_EMPLOYMENT_DETAILS_V' }] },
  'GET /dev-console/describe': {
    query: [{ key: 'name', value: 'XXHMC_SND_EMPLOYMENT_DETAILS_V' }],
  },
  'GET /dev-console/objects': {
    query: [
      { key: 'search', value: 'XXHMC_SND_', disabled: true },
      { key: 'type', value: 'VIEW', disabled: true },
    ],
  },
};

function requestBodyTemplate(content, document) {
  if (!content) return undefined;
  let schema = content.schema;
  if (schema?.$ref) schema = document.components?.schemas?.[schema.$ref.split('/').pop()];
  const example = extractExample(content, document);
  if (!schema?.properties) return example ?? {};
  const body = example === undefined ? {} : clone(example);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
  for (const key of schema.required || []) {
    if (body[key] !== undefined) continue;
    const property = schema.properties[key];
    body[key] =
      exampleFromSchema(property, document) ??
      property?.enum?.[0] ??
      (property?.type === 'boolean' ? false : property?.type === 'array' ? [] : `{{${key}}}`);
  }
  return body;
}

function newRequest(route, document) {
  const operation = route.operation || {};
  const override = requestOverrides[keyOf(route)] || {};
  const segments = route.path
    .slice(1)
    .split('/')
    .map((segment) => segment.replace(/^\{([^}]+)\}$/, ':$1'));
  const params = operation.parameters || [];
  const query =
    override.query ??
    params
      .filter((param) => param.in === 'query')
      .map((param) => {
        const value = param.example ?? param.schema?.example ?? param.schema?.default;
        return {
          key: param.name,
          value: value === undefined ? '' : String(value),
          ...(param.description ? { description: param.description } : {}),
          ...(value === undefined && !param.required ? { disabled: true } : {}),
        };
      });
  const variable = segments
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => {
      const key = segment.slice(1);
      const param = params.find((p) => p.in === 'path' && p.name === key);
      return { key, value: String(param?.example ?? param?.schema?.example ?? '') };
    });
  const active = query.filter((p) => !p.disabled);
  const raw =
    `{{baseUrl}}/${segments.join('/')}` +
    (active.length
      ? '?' + active.map((p) => `${p.key}=${encodeQueryValue(p.value)}`).join('&')
      : '');
  const body =
    override.body ??
    requestBodyTemplate(operation.requestBody?.content?.['application/json'], document);
  const request = {
    ...(route.public ? { auth: { type: 'noauth' } } : {}),
    method: route.method,
    header: body === undefined ? [] : [{ key: 'Content-Type', value: 'application/json' }],
    url: {
      raw,
      host: ['{{baseUrl}}'],
      path: segments,
      ...(query.length ? { query } : {}),
      ...(variable.length ? { variable } : {}),
    },
    ...(body === undefined
      ? {}
      : {
          body: {
            mode: 'raw',
            raw: JSON.stringify(body, null, 2),
            options: { raw: { language: 'json' } },
          },
        }),
    description: `**Purpose:** ${operation.summary || route.path}\n\n**Auth:** ${route.public ? 'Public' : 'Bearer {{token}} required'}.\n\nGenerated from current backend metadata; not a live capture. Fill required device, document, or business values before sending.\n\n${operation.description || ''}`,
  };
  if (route.path.startsWith('/dev-console'))
    request.header.push({
      key: 'x-console-token',
      value: '{{consoleToken}}',
      disabled: true,
      description: 'Enable when the developer console is configured to require its separate token.',
    });
  const item = {
    name: `${route.method} ${segments.length ? '/' + segments.join('/') : '/'}`,
    request,
    response: [],
  };
  const status = route.status ?? (operation.responses?.['201'] ? 201 : 200);
  const example = extractExample(
    operation.responses?.[String(status)]?.content?.['application/json'],
    document,
  );
  if (example !== undefined)
    item.response.push({
      name: `Example (${status}) — generated, not captured`,
      originalRequest: clone(request),
      status: status === 201 ? 'Created' : 'OK',
      code: status,
      _postman_previewlanguage: 'json',
      header: [{ key: 'Content-Type', value: 'application/json' }],
      body: JSON.stringify(example, null, 2),
    });
  return item;
}

function folderName(route) {
  const prefix = route.path.split('/')[1];
  return (
    {
      auth: 'Auth',
      healthcheck: 'Auth',
      health: 'Health',
      'annual-ticket': 'Annual Ticket',
      approvals: 'Approvals',
      notifications: 'Notifications',
      'app-integrity': 'App Integrity',
      'dev-console': 'Internal - Developer Console (dev only)',
      diagnostics: 'Internal - Diagnostics (dev only)',
      'api-logs': 'Internal - Diagnostics (dev only)',
    }[prefix] ||
    prefix.replace(/(^|-)(\w)/g, (_, gap, char) => (gap ? ' ' : '') + char.toUpperCase())
  );
}

function addItem(items, route, item) {
  const name = folderName(route);
  let folder = items.find((entry) => entry.name === name && entry.item);
  if (!folder) {
    folder = { name, item: [] };
    items.push(folder);
  }
  folder.item.push(item);
}

function setFolderEvent(folder, listen, id, exec) {
  folder.event ||= [];
  const event = { listen, script: { id, type: 'text/javascript', exec } };
  const index = folder.event.findIndex((entry) => entry.script?.id === id);
  if (index < 0) folder.event.push(event);
  else folder.event[index] = event;
}

function buildVersionedCollection(source, catalog) {
  const collection = clone(source);
  const original = collection.item || [];
  const existingV1 = original.find((item) => item.name === 'v1' && item.item);
  const existingV2 = original.find((item) => item.name === 'v2' && item.item);
  const v1 = existingV1 || {
    name: 'v1',
    item: [],
    description:
      'Original v1 requests and captured examples, with missing routes added from backend metadata.',
  };
  v1.item.push(...original.filter((item) => item !== existingV1 && item !== existingV2));
  const v2 = existingV2 || {
    name: 'v2',
    item: [],
    description:
      'Complete v2 API. Leave baseUrlV2 blank to derive it from baseUrl, or set it to a direct v2 backend URL. The gateway must separately support v2. Protected requests use JWT identity, not identity query parameters. Saved examples are adapted references, not v2 captures.',
  };
  const routesV1 = catalog.routes.filter((route) => route.version === '1');
  const routesV2 = catalog.routes.filter((route) => route.version === '2');
  const present = new Set(
    [...requests(v1.item)].map(({ item }) => {
      const route = findRoute(item, routesV1);
      if (!route) throw new Error(`No backend route matches existing request: ${item.name}`);
      return keyOf(route);
    }),
  );
  for (const route of routesV1)
    if (!present.has(keyOf(route))) addItem(v1.item, route, newRequest(route, catalog.document));
  const v2Present = new Set(
    [...requests(v2.item)].map(({ item }) => {
      const route = findRoute(item, routesV2);
      if (!route) throw new Error(`No v2 backend route matches request: ${item.name}`);
      if (
        typeof item.request.description === 'string' &&
        item.request.description.startsWith('**API v2:**')
      ) {
        const queryLine = v2Description(item, route)
          .split('\n\n')
          .find((line) => line.startsWith('**Query parameters:**'));
        item.request.description = item.request.description.replace(
          /^\*\*Query parameters:\*\*.*$/m,
          queryLine,
        );
      }
      return keyOf(route);
    }),
  );
  for (const { item, parents } of requests(v1.item)) {
    const route = findRoute(item, routesV2);
    if (!route) throw new Error(`No v2 counterpart for ${item.name}`);
    if (v2Present.has(keyOf(route))) continue;
    let target = v2.item;
    for (const name of parents) {
      let folder = target.find((entry) => entry.name === name && entry.item);
      if (!folder) {
        folder = { name, item: [] };
        target.push(folder);
      }
      target = folder.item;
    }
    target.push(copyV2(item, route));
    v2Present.add(keyOf(route));
  }
  collection.variable ||= [];
  if (!collection.variable.some((variable) => variable.key === 'baseUrlV2'))
    collection.variable.push({
      key: 'baseUrlV2',
      value: '',
      type: 'string',
      description:
        'Optional v2 base URL. Blank derives /v2 from the current baseUrl in the v2 folder pre-request script.',
    });
  if (!collection.variable.some((variable) => variable.key === 'refreshtoken'))
    collection.variable.push({ key: 'refreshtoken', value: '', type: 'string' });
  for (const { item } of requests([v1, v2])) {
    for (const match of JSON.stringify(item.request).matchAll(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g)) {
      if (!collection.variable.some((variable) => variable.key === match[1]))
        collection.variable.push({
          key: match[1],
          value: '',
          type: 'string',
          description: 'Fill with an authorized test value before sending the request.',
        });
    }
  }
  setFolderEvent(v1, 'test', 'hmc-session-v1', sessionScript);
  setFolderEvent(v2, 'test', 'hmc-session-v2', sessionScript);
  setFolderEvent(v2, 'prerequest', 'hmc-v2-base-url', v2BaseScript);
  collection.item = [v1, v2];
  collection.info.description = `HMC Sanaad backend API: ${routesV1.length} v1 routes and ${routesV2.length} v2 routes. Existing v1 requests, bodies, scripts, and captures are preserved; missing requests are generated from backend metadata. V2 references are adapted, not live captures.\n\nbaseUrl is the complete v1 URL (for example http://localhost:443/api/v1). baseUrlV2 is optional: leave blank to derive the v2 URL from baseUrl, or override it when using a different backend. Do not point v2 at the old gateway until its routing supports v2.\n\nLogin and refresh in either folder save token and refreshtoken. Public authentication keeps its username/device body fields. Protected v2 requests require a verified bearer token and must omit identity query parameters. Missing employee/person claims return 422.\n\nThis collection contains mutating and administrative APIs. Use authorized test data; do not run the entire collection against production.`;
  return collection;
}

function validateCollection(collection, catalog) {
  if (JSON.stringify(collection.item.map((item) => item.name)) !== '["v1","v2"]')
    throw new Error('Expected only v1 and v2 root folders.');
  for (const version of ['1', '2']) {
    const routes = catalog.routes.filter((route) => route.version === version);
    const items = [
      ...requests(collection.item.find((folder) => folder.name === `v${version}`).item),
    ];
    const found = new Set();
    for (const { item } of items) {
      const route = findRoute(item, routes);
      if (!route) throw new Error(`Unknown route: ${item.name}`);
      found.add(keyOf(route));
      const url = item.request.url;
      const raw = typeof url === 'string' ? url : url.raw;
      const base = version === '2' ? '{{baseUrlV2}}' : '{{baseUrl}}';
      if (!raw.startsWith(base + '/')) throw new Error(`Unexpected base URL: ${item.name}`);
      if (version === '2' && !route.public) {
        if (item.request.auth?.type === 'noauth')
          throw new Error(`Protected v2 request has noauth: ${item.name}`);
        if ((url.query || []).some((param) => IDENTITY_QUERY.test(param.key)))
          throw new Error(`V2 identity query: ${item.name}`);
        const query = raw.split('?')[1]?.split('#')[0] || '';
        if (query.split('&').some((part) => IDENTITY_QUERY.test(decodeKey(part.split('=')[0]))))
          throw new Error(`V2 raw identity query: ${item.name}`);
      }
    }
    if (found.size !== routes.length)
      throw new Error(`v${version}: ${found.size}/${routes.length} routes covered.`);
  }
}

async function main() {
  const file = path.join(__dirname, 'HMC-Sanaad-Full.postman_collection.json');
  const environmentFile = path.join(__dirname, 'HMC-Sanaad-Full.postman_environment.json');
  const text = fs.readFileSync(file, 'utf8');
  const environmentText = fs.readFileSync(environmentFile, 'utf8');
  const catalog = await loadBackendCatalog();
  const source = JSON.parse(text);
  const collection = process.argv.includes('--check')
    ? source
    : buildVersionedCollection(source, catalog);
  validateCollection(collection, catalog);
  if (!process.argv.includes('--check')) {
    const environment = JSON.parse(environmentText);
    if (!environment.values.some((variable) => variable.key === 'baseUrlV2'))
      environment.values.push({ key: 'baseUrlV2', value: '', type: 'default', enabled: true });
    const serialize = (value, original) => {
      const result = JSON.stringify(value, null, 2) + '\n';
      return original.includes('\r\n') ? result.replace(/\n/g, '\r\n') : result;
    };
    fs.writeFileSync(file, serialize(collection, text));
    fs.writeFileSync(environmentFile, serialize(environment, environmentText));
  }
  console.log(
    collection.item
      .map((folder) => `${folder.name}: ${[...requests(folder.item)].length} requests`)
      .join('\n'),
  );
}

module.exports = {
  buildVersionedCollection,
  validateCollection,
  requests,
  findRoute,
  rewriteUrl,
  rewriteLinks,
  sessionScript,
  v2BaseScript,
};
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
