'use strict';

require('reflect-metadata');

const { readdirSync, statSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { RequestMethod } = require('@nestjs/common');
const {
  CONTROLLER_WATERMARK,
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PARAMTYPES_METADATA,
  PATH_METADATA,
  SELF_DECLARED_DEPS_METADATA,
  VERSION_METADATA,
} = require('@nestjs/common/constants');
const { ConfigService } = require('@nestjs/config');
const { Reflector } = require('@nestjs/core');
const { DECORATORS, DocumentBuilder, SwaggerModule } = require('@nestjs/swagger');
const { Test } = require('@nestjs/testing');

const distDirectory = resolve(__dirname, '..', 'dist');
const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD', 'SEARCH', 'TRACE'];
const asArray = (value) => (Array.isArray(value) ? value : [value]);

function requireCompiledBuild() {
  const helperPath = join(distDirectory, 'core', 'http', 'api-versioning.js');
  const publicPath = join(distDirectory, 'core', 'auth', 'decorators', 'public.decorator.js');
  try {
    if (!statSync(distDirectory).isDirectory()) throw new Error('dist is not a directory');
    for (const file of [helperPath, publicPath]) {
      if (!statSync(file).isFile()) throw new Error(`Missing compiled helper: ${file}`);
    }
  } catch (cause) {
    throw new Error('Backend build is missing. Run npm.cmd run build in HMC_BackEnd first.', {
      cause,
    });
  }
  const { configureApiVersioning } = require(helperPath);
  const { IS_PUBLIC_KEY } = require(publicPath);
  if (typeof configureApiVersioning !== 'function' || typeof IS_PUBLIC_KEY !== 'string') {
    throw new Error('Backend compiled helpers are invalid. Run npm.cmd run build first.');
  }
  return { configureApiVersioning, IS_PUBLIC_KEY };
}

function discoverCompiledControllers(directory) {
  const controllers = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      controllers.push(...discoverCompiledControllers(file));
    } else if (entry.isFile() && entry.name.endsWith('.controller.js')) {
      const exports = require(file);
      for (const value of [exports, ...Object.values(exports)]) {
        if (
          typeof value === 'function' &&
          Reflect.getMetadata(CONTROLLER_WATERMARK, value) === true
        ) {
          controllers.push(value);
        }
      }
    }
  }
  return [...new Set(controllers)];
}

function controllerHandlers(controller) {
  const handlers = [];
  const names = new Set(['constructor']);
  for (
    let prototype = controller.prototype;
    prototype && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype)
  ) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (names.has(name)) continue;
      names.add(name);
      const handler = Object.getOwnPropertyDescriptor(prototype, name).value;
      if (typeof handler === 'function' && Reflect.hasMetadata(METHOD_METADATA, handler)) {
        handlers.push({ name, handler });
      }
    }
  }
  return handlers;
}

function openApiRelativePath(base, suffix) {
  if (typeof base !== 'string' || typeof suffix !== 'string') {
    throw new Error('Controller and handler path metadata must contain strings.');
  }
  return (
    `/${base}/${suffix}`
      .replace(/\/+/g, '/')
      .replace(/\/$/, '')
      .replace(/:([A-Za-z0-9_]+)/g, '{$1}') || '/'
  );
}

function collectVersionedRouteMetadata(controllers, publicKey) {
  const reflector = new Reflector();
  const routes = [];
  const keys = new Set();
  for (const controller of controllers) {
    const bases = asArray(Reflect.getMetadata(PATH_METADATA, controller) ?? '/');
    const excludedController = asArray(
      Reflect.getMetadata(DECORATORS.API_EXCLUDE_CONTROLLER, controller),
    ).includes(true);
    for (const { name, handler } of controllerHandlers(controller)) {
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler);
      const methods =
        requestMethod === RequestMethod.ALL
          ? httpMethods.filter((method) => method !== 'TRACE')
          : [RequestMethod[requestMethod]];
      if (methods.some((method) => !httpMethods.includes(method))) {
        throw new Error(`Unsupported HTTP method on ${controller.name}.${name}.`);
      }
      const versions = asArray(
        Reflect.getMetadata(VERSION_METADATA, handler) ??
          Reflect.getMetadata(VERSION_METADATA, controller) ??
          '1',
      );
      const suffixes = asArray(Reflect.getMetadata(PATH_METADATA, handler) ?? '/');
      for (const version of versions) {
        if (version !== '1' && version !== '2') {
          throw new Error(
            `Unsupported API version on ${controller.name}.${name}: ${String(version)}`,
          );
        }
        for (const base of bases) {
          for (const suffix of suffixes) {
            const path = openApiRelativePath(base, suffix);
            for (const method of methods) {
              const key = `${method} v${version} ${path}`;
              if (keys.has(key)) throw new Error(`Duplicate backend route: ${key}`);
              keys.add(key);
              routes.push({
                version,
                method,
                path,
                status:
                  Reflect.getMetadata(HTTP_CODE_METADATA, handler) ??
                  (method === 'POST' ? 201 : 200),
                public: reflector.getAllAndOverride(publicKey, [handler, controller]) === true,
                controller: controller.name,
                hidden:
                  excludedController ||
                  Reflect.getMetadata(DECORATORS.API_EXCLUDE_ENDPOINT, handler)?.disable === true,
                controllerClass: controller,
                handler,
              });
            }
          }
        }
      }
    }
  }
  if (!routes.length) throw new Error('No backend routes found. Run npm.cmd run build first.');
  return routes;
}

function inertControllerProviders(controllers) {
  const tokens = new Set();
  for (const controller of controllers) {
    const dependencies = [...(Reflect.getMetadata(PARAMTYPES_METADATA, controller) ?? [])];
    for (const dependency of Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, controller) ?? []) {
      dependencies[dependency.index] = dependency.param;
    }
    for (const dependency of dependencies) {
      const token = dependency?.forwardRef ? dependency.forwardRef() : dependency;
      if (token === undefined || token === null) {
        throw new Error(
          `Unresolved constructor dependency on ${controller.name}. Rebuild the backend.`,
        );
      }
      tokens.add(token);
    }
  }
  const config = new ConfigService({ app: { nodeEnv: 'test' }, usersDb: {} });
  config.skipProcessEnv = true;
  return [...tokens].map((provide) => ({
    provide,
    useValue: provide === ConfigService ? config : Object.create(null),
  }));
}

function createDocumentWithRestoredSwaggerVisibility(app, controllers, routes) {
  const exclusions = new Map();
  function rememberExclusion(target, key) {
    for (let current = target; current; current = Object.getPrototypeOf(current)) {
      if (!Reflect.hasOwnMetadata(key, current)) continue;
      if (!exclusions.has(current)) exclusions.set(current, new Map());
      exclusions.get(current).set(key, Reflect.getOwnMetadata(key, current));
    }
  }
  for (const controller of controllers) {
    rememberExclusion(controller, DECORATORS.API_EXCLUDE_CONTROLLER);
  }
  for (const { handler } of routes) {
    rememberExclusion(handler, DECORATORS.API_EXCLUDE_ENDPOINT);
  }
  try {
    for (const [target, metadata] of exclusions) {
      for (const key of metadata.keys()) Reflect.deleteMetadata(key, target);
    }
    return SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Offline backend route catalog').addBearerAuth().build(),
    );
  } finally {
    for (const [target, metadata] of exclusions) {
      for (const [key, value] of metadata) Reflect.defineMetadata(key, value, target);
    }
  }
}

function attachAndValidateDocumentOperations(document, metadata) {
  const expected = new Set();
  const routes = metadata.map(({ controllerClass, handler, ...route }) => {
    const path = `/api/v${route.version}${route.path === '/' ? '' : route.path}`;
    const method = route.method.toLowerCase();
    const operation = document.paths[path]?.[method];
    if (!operation) throw new Error(`Swagger is missing backend route: ${route.method} ${path}`);
    expected.add(`${method} ${path}`);
    return { ...route, operation };
  });
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of httpMethods.map((value) => value.toLowerCase())) {
      if (item[method] && !expected.has(`${method} ${path}`)) {
        throw new Error(
          `Swagger contains an uninventoried backend route: ${method.toUpperCase()} ${path}`,
        );
      }
    }
  }
  return routes.sort((a, b) =>
    `${a.version} ${a.path} ${a.method}`.localeCompare(`${b.version} ${b.path} ${b.method}`),
  );
}

async function loadBackendCatalog() {
  const { configureApiVersioning, IS_PUBLIC_KEY } = requireCompiledBuild();
  const controllers = discoverCompiledControllers(distDirectory);
  if (!controllers.length) {
    throw new Error('No compiled backend controllers found. Run npm.cmd run build first.');
  }
  const metadata = collectVersionedRouteMetadata(controllers, IS_PUBLIC_KEY);
  const builder = Test.createTestingModule({
    controllers,
    providers: inertControllerProviders(controllers),
  });
  const guards = new Set(
    metadata.flatMap(({ controllerClass, handler }) => [
      ...(Reflect.getMetadata(GUARDS_METADATA, controllerClass) ?? []),
      ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? []),
    ]),
  );
  for (const guard of guards) {
    if (typeof guard === 'function') {
      builder.overrideGuard(guard).useValue({ canActivate: () => true });
    }
  }
  const module = await builder.compile();
  let app;
  try {
    app = module.createNestApplication({ logger: false });
    configureApiVersioning(app, 'api/v1');
    await app.init();
    const document = createDocumentWithRestoredSwaggerVisibility(app, controllers, metadata);
    return { document, routes: attachAndValidateDocumentOperations(document, metadata) };
  } finally {
    await (app ?? module).close();
  }
}

function omitUndefinedExampleValues(value, depth = 0) {
  if (depth > 30 || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => omitUndefinedExampleValues(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, omitUndefinedExampleValues(item, depth + 1)])
        .filter(([, item]) => item !== undefined),
    );
  }
  return value;
}

function resolveLocalSchemaReference(reference, document) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return undefined;
  try {
    return reference
      .slice(2)
      .split('/')
      .map((part) => decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce(
        (value, key) =>
          value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined,
        document,
      );
  } catch {
    return undefined;
  }
}

function mergeComposedExamples(left, right) {
  if (right === undefined) return left;
  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    return Object.fromEntries(
      [...new Set([...Object.keys(left), ...Object.keys(right)])].map((key) => [
        key,
        mergeComposedExamples(left[key], right[key]),
      ]),
    );
  }
  return right;
}

function exampleFromSchema(schema, document, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 20) return undefined;
  if (schema.example !== undefined) return omitUndefinedExampleValues(schema.example);
  if (schema.default !== undefined) return omitUndefinedExampleValues(schema.default);
  let example;
  if (schema.$ref) {
    example = exampleFromSchema(
      resolveLocalSchemaReference(schema.$ref, document),
      document,
      depth + 1,
    );
  }
  for (const part of schema.allOf ?? []) {
    example = mergeComposedExamples(example, exampleFromSchema(part, document, depth + 1));
  }
  for (const alternatives of [schema.oneOf, schema.anyOf]) {
    for (const part of alternatives ?? []) {
      const candidate = exampleFromSchema(part, document, depth + 1);
      if (candidate !== undefined) {
        example = mergeComposedExamples(example, candidate);
        break;
      }
    }
  }
  if (schema.type === 'array' || schema.items) {
    const item = exampleFromSchema(schema.items, document, depth + 1);
    return item === undefined ? (example ?? []) : [item];
  }
  if (schema.properties) {
    const properties = Object.fromEntries(
      Object.entries(schema.properties)
        .map(([key, value]) => [key, exampleFromSchema(value, document, depth + 1)])
        .filter(([, value]) => value !== undefined),
    );
    if (Object.keys(properties).length) example = mergeComposedExamples(example, properties);
  }
  return example;
}

module.exports = { loadBackendCatalog, exampleFromSchema };
