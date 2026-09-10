/*
 * Syncs HMC-Sanaad-Full.postman_collection.json from the live Swagger doc
 * (postman/local-swagger.json — refresh it from a running backend first:
 *   Invoke-WebRequest http://localhost:<port>/docs-json -OutFile postman/local-swagger.json
 * ).
 *
 * What it updates on every request the collection and Swagger both know
 * (matched by METHOD + path, /api/v1 prefix and path-param names normalized):
 *
 *  1. Request body — replaced with the Swagger request example, in priority
 *     order: the named `verified` example (@VerifiedBody, staging-verified
 *     payloads) > content-level `example` > a body assembled from the schema's
 *     per-property examples.
 *  2. Success response — every saved 200 example is replaced with a single
 *     "Success (200)" example holding the Swagger-documented 200 response
 *     example (the *.examples.ts captures, already wrapped in the Sanaad
 *     envelope by the response decorators). Non-200 examples (errors) are
 *     kept untouched. Requests whose Swagger op documents no 200 example
 *     keep their existing responses.
 *
 * Idempotent — safe to run repeatedly. Preserves the file's CRLF endings.
 *
 * Run with: node postman/sync-from-swagger.js
 */
const fs = require('fs');
const path = require('path');
const { rewriteLinks } = require('./version-collection');

const collectionPath = path.join(__dirname, 'HMC-Sanaad-Full.postman_collection.json');
const swagger = require(path.join(__dirname, 'local-swagger.json'));
const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

// ── swagger lookup by normalized METHOD + path ─────────────────────────────
const normParams = (p) => p.replace(/\{\{[^}]+\}\}|\{[^}]+\}|:[^/]+/g, '{*}');
const swaggerOps = new Map();
for (const [p, methods] of Object.entries(swagger.paths)) {
  const version = p.match(/^\/api\/(v[12])(?=\/|$)/)?.[1] ?? 'v1';
  const rel = p.replace(/^\/api\/v[12](?=\/|$)/, '') || '/';
  for (const [m, op] of Object.entries(methods)) {
    if (['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'].includes(m)) {
      swaggerOps.set(`${version} ${m.toUpperCase()} ${normParams(rel)}`, op);
    }
  }
}

function* requestGroups(items, version = 'v1', name = '') {
  yield { item: items, version, name };
  for (const item of items) {
    if (item.item) yield* requestGroups(item.item, ['v1', 'v2'].includes(item.name) ? item.name : version, `${name}/${item.name}`);
  }
}

// ── request-body example extraction ────────────────────────────────────────
function resolveSchema(schema) {
  if (schema && schema.$ref) return swagger.components.schemas[schema.$ref.split('/').pop()];
  return schema;
}
function exampleFromSchema(schema, depth = 0) {
  schema = resolveSchema(schema);
  if (!schema || depth > 6) return undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.type === 'array') {
    const item = exampleFromSchema(schema.items, depth + 1);
    return item === undefined ? [] : [item];
  }
  if (schema.properties) {
    const out = {};
    for (const [k, p] of Object.entries(schema.properties)) {
      const v = exampleFromSchema(p, depth + 1);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return undefined;
}
function requestBodyExample(op) {
  const content = op.requestBody && op.requestBody.content && op.requestBody.content['application/json'];
  if (!content) return undefined;
  if (content.examples) {
    const named = content.examples.verified ?? Object.values(content.examples)[0];
    if (named && named.value !== undefined) return named.value;
  }
  if (content.example !== undefined) return content.example;
  return exampleFromSchema(content.schema);
}
function successResponseExample(op) {
  const ok = op.responses && (op.responses['200'] ?? op.responses['201']);
  const content = ok && ok.content && ok.content['application/json'];
  if (!content) return undefined;
  if (content.example !== undefined) return content.example;
  if (content.examples) {
    const first = Object.values(content.examples)[0];
    if (first && first.value !== undefined) return first.value;
  }
  return exampleFromSchema(content.schema);
}

// ── apply to the collection ────────────────────────────────────────────────
let bodyUpdates = 0;
let responseUpdates = 0;
const unmatched = [];

for (const folder of requestGroups(collection.item)) {
  for (const item of folder.item ?? []) {
    if (!item.request) continue;
    const url = item.request.url;
    const rawPath = '/' + ((url && url.path) || []).join('/');
    const namedPath = item.name?.match(/^[A-Z]+\s+(\/\S+)/)?.[1]?.split('?')[0];
    const method = item.request.method.toUpperCase();
    const key = `${folder.version} ${method} ${normParams(namedPath || rawPath)}`;
    const op = swaggerOps.get(key) ?? swaggerOps.get(`${folder.version} ${method} ${normParams(rawPath)}`);
    if (!op) {
      unmatched.push(`${folder.name} / ${item.name}`);
      continue;
    }

    // 1. request body
    const bodyExample = requestBodyExample(op);
    if (bodyExample !== undefined && typeof bodyExample === 'object') {
      const raw = JSON.stringify(bodyExample, null, 2);
      if (!item.request.body || item.request.body.raw !== raw) {
        item.request.body = {
          mode: 'raw',
          raw,
          options: { raw: { language: 'json' } },
        };
        bodyUpdates++;
      }
    }

    // 2. success response example
    const okExample = successResponseExample(op);
    if (okExample !== undefined) {
      const body = JSON.stringify(folder.version === 'v2' ? rewriteLinks(okExample) : okExample, null, 2);
      const responses = item.response ?? [];
      const non200 = responses.filter((r) => r.code !== 200);
      const existing200 = responses.find((r) => r.code === 200);
      const already = existing200 && existing200.body === body && responses.filter((r) => r.code === 200).length === 1;
      if (!already) {
        const success = {
          name: 'Success (200)',
          originalRequest: {
            method: item.request.method,
            header: [],
            url: item.request.url,
            ...(item.request.body ? { body: item.request.body } : {}),
          },
          status: 'OK',
          code: 200,
          _postman_previewlanguage: 'json',
          header: [{ key: 'Content-Type', value: 'application/json; charset=utf-8' }],
          cookie: [],
          body,
        };
        item.response = [success, ...non200];
        responseUpdates++;
      }
    }
  }
}

fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2).replace(/\n/g, '\r\n') + '\r\n');
console.log(`Request bodies updated: ${bodyUpdates}`);
console.log(`Success (200) examples updated: ${responseUpdates}`);
if (unmatched.length) {
  console.log(`No Swagger match (left untouched): ${unmatched.length}`);
  unmatched.forEach((u) => console.log('  - ' + u));
}
