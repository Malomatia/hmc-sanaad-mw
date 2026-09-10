import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { INestApplication, RequestMethod, Type } from '@nestjs/common';
import {
  CONTROLLER_WATERMARK,
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PARAMTYPES_METADATA,
  PATH_METADATA,
  RESPONSE_PASSTHROUGH_METADATA,
  ROUTE_ARGS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
  VERSION_METADATA,
} from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DECORATORS, DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { LookupsController } from '@lookups/interface/lookups.controller';
import { AnnualTicketController } from '@modules/annual-ticket/interface/annual-ticket.controller';
import { AppIntegrityController } from '@modules/app-integrity/interface/app-integrity.controller';
import { AppointmentsController } from '@modules/appointments/interface/appointments.controller';
import { ApprovalsController } from '@modules/approvals/interface/approvals.controller';
import { AuthController } from '@modules/auth/interface/auth.controller';
import { HealthCheckController } from '@modules/auth/interface/healthcheck.controller';
import { ContactController } from '@modules/contact/interface/contact.controller';
import { DependentsController } from '@modules/dependents/interface/dependents.controller';
import { EmployeeController } from '@modules/employee/interface/employee.controller';
import { IdentityController } from '@modules/identity/interface/identity.controller';
import { LeaveController } from '@modules/leave/interface/leave.controller';
import { LeavesController } from '@modules/leave/interface/leaves.controller';
import { LettersController } from '@modules/letters/interface/letters.controller';
import { NotificationsController } from '@modules/notifications/interface/notifications.controller';
import { PayslipController } from '@modules/payslip/interface/payslip.controller';
import { ProfileController } from '@modules/profile/interface/profile.controller';
import { SchoolFeesController } from '@modules/school-fees/interface/school-fees.controller';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { DiagnosticsController } from '../database/diagnostics.controller';
import { DevConsoleController } from '../dev-console/dev-console.controller';
import { DevConsoleGuard } from '../dev-console/dev-console.guard';
import { EmailDiagnosticsController } from '../email/email-diagnostics.controller';
import { HealthController } from '../health/health.controller';
import { SKIP_INTEGRITY_KEY } from '../integrity/skip-integrity.decorator';
import { ApiLogsController } from '../logging/api-logs.controller';
import { configureApiVersioning } from './api-versioning';
import { DiagnosticsEnabledGuard } from './diagnostics-enabled.guard';
import { SKIP_ENVELOPE } from './response.interceptor';

const inventory: { controller: Type<object>; paths: string[] }[] = [
  {
    controller: AuthController,
    paths: [
      'POST /auth/initiate',
      'POST /auth/send-otp',
      'POST /auth/otp/validate',
      'POST /auth/mpin/update',
      'POST /auth/login',
      'POST /auth/mpin/forgot',
      'POST /auth/mpin/update/reset',
      'POST /auth/token/refresh',
      'POST /auth/logout',
      'GET /auth/me',
    ],
  },
  { controller: HealthCheckController, paths: ['POST /healthcheck'] },
  {
    controller: HealthController,
    paths: [
      'GET /health',
      'GET /health/ready',
      'GET /health/db',
      'GET /health/users-db',
      'GET /health/motc-sms-db',
    ],
  },
  {
    controller: DiagnosticsController,
    paths: [
      'GET /diagnostics/oracle-views',
      'POST /diagnostics/oracle/sql',
      'POST /diagnostics/users-db/sql',
      'POST /diagnostics/motc-sms-db/sql',
      'GET /diagnostics/oracle-object',
      'GET /diagnostics/oracle-logs/view',
      'GET /diagnostics/oracle-logs',
      'GET /diagnostics/oracle-logs/stats',
      'DELETE /diagnostics/oracle-logs',
    ],
  },
  { controller: EmailDiagnosticsController, paths: ['POST /diagnostics/email/test'] },
  {
    controller: ApiLogsController,
    paths: [
      'GET /api-logs/view',
      'GET /api-logs/statistics',
      'GET /api-logs/errors',
      'GET /api-logs/success',
      'GET /api-logs/slow',
      'DELETE /api-logs',
      'GET /api-logs',
      'GET /api-logs/:id',
    ],
  },
  {
    controller: DevConsoleController,
    paths: [
      'GET /dev-console',
      'GET /dev-console/settings',
      'POST /dev-console/mode',
      'POST /dev-console/execute',
      'GET /dev-console/objects',
      'GET /dev-console/describe',
      'GET /dev-console/source',
      'POST /dev-console/explain',
      'POST /dev-console/api-call',
    ],
  },
  {
    controller: AppIntegrityController,
    paths: [
      'GET /app-integrity/challenge',
      'POST /app-integrity/ios/register',
      'POST /app-integrity/android/verify',
    ],
  },
  {
    controller: NotificationsController,
    paths: [
      'POST /notifications/device-token',
      'POST /notifications/device-token/unregister',
      'POST /notifications/device-token/test',
      'DELETE /notifications/device-token',
    ],
  },
  {
    controller: ProfileController,
    paths: [
      'GET /profile',
      'POST /profile/personal',
      'GET /profile/notifications',
      'GET /profile/notifications/summary',
      'GET /profile/notifications/:id/history',
      'GET /profile/lov/marital-status',
    ],
  },
  {
    controller: EmployeeController,
    paths: [
      'GET /employee/employment',
      'GET /employee/basic',
      'GET /employee/performance',
      'GET /employee/supervisor/views',
      'POST /employee/supervisor',
    ],
  },
  {
    controller: PayslipController,
    paths: ['GET /payslip/periods', 'GET /payslip/count', 'GET /payslip'],
  },
  {
    controller: LeaveController,
    paths: [
      'GET /leave/balance',
      'POST /leave/apply',
      'POST /leave/calculate',
      'POST /leave/amend',
      'POST /leave/cancel',
      'POST /leave/return',
      'GET /leave/lov/types',
      'GET /leave/lov/reasons',
      'GET /leave/lov/classes',
      'GET /leave/lov/defaults',
      'GET /leave/lov/request-lov',
      'GET /leave/lov/return',
      'GET /leave/lov/return-details',
      'GET /leave/lov/return-related1',
      'GET /leave/lov/return-related2',
      'GET /leave/lov/cancel',
      'GET /leave/lov/amend',
    ],
  },
  { controller: LeavesController, paths: ['GET /leaves'] },
  { controller: LettersController, paths: ['GET /letters/lov', 'POST /letters/apply'] },
  {
    controller: ContactController,
    paths: [
      'GET /contact/lov/phone-type',
      'POST /contact/phone',
      'POST /contact/phone/delete',
      'POST /contact/address',
      'POST /contact/address/update',
      'GET /contact/lov/country',
    ],
  },
  {
    controller: DependentsController,
    paths: [
      'POST /dependents',
      'POST /dependents/update',
      'POST /dependents/delete',
      'GET /dependents/lov',
      'GET /dependents/passport/types',
      'POST /dependents/passport/apply',
      'GET /dependents/passport/issue-place',
    ],
  },
  {
    controller: IdentityController,
    paths: [
      'GET /identity/qid',
      'POST /identity/qid/update',
      'POST /identity/idcard/apply',
      'GET /identity/lov/work-location',
      'GET /identity/lov/delivery-location',
      'GET /identity/lov/reason',
    ],
  },
  {
    controller: SchoolFeesController,
    paths: [
      'POST /school-fees/apply',
      'GET /school-fees/lov/schools',
      'GET /school-fees/lov/terms',
      'GET /school-fees/lov/edu-stage',
      'GET /school-fees/lov/academic-year',
      'GET /school-fees/lov/request-type',
      'GET /school-fees/children',
    ],
  },
  {
    controller: AppointmentsController,
    paths: [
      'GET /appointments/upcoming',
      'GET /appointments/masters',
      'GET /appointments/booking-init',
      'POST /appointments/book',
    ],
  },
  {
    controller: AnnualTicketController,
    paths: [
      'GET /annual-ticket/master',
      'POST /annual-ticket/apply',
      'GET /annual-ticket/cancel-options',
      'POST /annual-ticket/cancel',
    ],
  },
  {
    controller: ApprovalsController,
    paths: [
      'GET /approvals',
      'GET /approvals/my-requests',
      'GET /approvals/pending-count',
      'GET /approvals/worklist',
      'GET /approvals/worklist/summary',
      'GET /approvals/worklist/:id/history',
      'GET /approvals/:id/details',
      'GET /approvals/attachments/:documentId',
      'POST /approvals/:id/decision',
      'POST /approvals/:id/request-info',
      'POST /approvals/:id/reassign',
    ],
  },
  {
    controller: LookupsController,
    paths: [
      'GET /lookups/yes-no',
      'GET /lookups/rfmi-user',
      'GET /lookups/lov',
      'GET /lookups/master',
    ],
  },
];

const identityOperationIds = new Set([
  'profile_get',
  'profile_notifications',
  'profile_notificationSummary',
  'employee_employment',
  'employee_basic',
  'employee_performance',
  'employee_supervisorViews',
  'payslip_periods',
  'payslip_count',
  'payslip_generate',
  'leave_balance',
  'leave_defaults',
  'leave_requestLov',
  'leave_returnLov',
  'leave_returnDetailsLov',
  'leave_relatedLeave1Lov',
  'leave_relatedLeave2Lov',
  'leave_cancelLov',
  'leave_amendLov',
  'leave_list',
  'letters_lov',
  'identity_qid',
  'schoolFees_schoolsLov',
  'schoolFees_requestTypeLov',
  'schoolFees_children',
  'appointments_upcoming',
  'appointments_bookingInit',
  'annualTicket_cancelOptions',
  'approvals_summary',
  'approvals_myRequests',
  'approvals_pendingCount',
  'approvals_worklist',
  'approvals_worklistSummary',
  'approvals_details',
  'approvals_attachment',
  'lookups_lov',
]);

interface Route {
  controller: Type<object>;
  name: string;
  handler: (...args: unknown[]) => unknown;
  method: RequestMethod;
  path: string;
  key: string;
  version: unknown;
}

const controllers = inventory.map(({ controller }) => controller);
const arrayOf = (value: string | string[]): string[] => (Array.isArray(value) ? value : [value]);
const routes: Route[] = controllers.flatMap((controller) =>
  Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
    const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
    if (typeof handler !== 'function') return [];
    const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
    if (method === undefined) return [];
    return arrayOf(Reflect.getMetadata(PATH_METADATA, controller)).flatMap((base) =>
      arrayOf(Reflect.getMetadata(PATH_METADATA, handler)).map((suffix) => {
        const path = `/${base}/${suffix}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
        return {
          controller,
          name,
          handler,
          method,
          path,
          key: `${RequestMethod[method]} ${path}`,
          version: Reflect.getMetadata(VERSION_METADATA, handler),
        };
      }),
    );
  }),
);
const legacyRoutes = routes.filter(({ version }) => version === undefined);
const v2Routes = routes.filter(({ version }) => version === '2');
const operationId = (route: Route): string | undefined =>
  Reflect.getMetadata(DECORATORS.API_OPERATION, route.handler)?.operationId;
const aliases = legacyRoutes.filter((route) => !identityOperationIds.has(operationId(route) ?? ''));
const counterpart = (original: Route): Route => {
  const matching = v2Routes.filter(({ key }) => key === original.key);
  expect(matching.map(({ controller, name }) => `${controller.name}.${name}`)).toHaveLength(1);
  expect(matching[0].controller).toBe(original.controller);
  expect(matching[0].handler).not.toBe(original.handler);
  return matching[0];
};
const argumentMetadata = (route: Route): Record<string, { index: number }> =>
  Reflect.getMetadata(ROUTE_ARGS_METADATA, route.controller, route.name) ?? {};
const parameterTypes = (route: Route): unknown[] =>
  Reflect.getMetadata(PARAMTYPES_METADATA, route.controller.prototype, route.name) ?? [];
const metadataWithoutRouting = (route: Route) =>
  new Map<string, unknown>(
    Reflect.getMetadataKeys(route.handler)
      .filter(
        (key) =>
          ![PATH_METADATA, METHOD_METADATA, VERSION_METADATA, DECORATORS.API_OPERATION].includes(
            key,
          ),
      )
      .map((key): [string, unknown] => [key, Reflect.getMetadata(key, route.handler)]),
  );
const effective = (route: Route, key: string) =>
  new Reflector().getAllAndOverride(key, [route.handler, route.controller]);
const effectiveGuards = (route: Route): unknown[] => [
  ...(Reflect.getMetadata(GUARDS_METADATA, route.controller) ?? []),
  ...(Reflect.getMetadata(GUARDS_METADATA, route.handler) ?? []),
];
const discoverControllers = async (directory: string): Promise<Type<object>[]> =>
  (
    await Promise.all(
      readdirSync(directory, { withFileTypes: true }).map(async (entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return discoverControllers(path);
        if (!entry.name.endsWith('.controller.ts')) return [];
        return Object.values(await import(path)).filter(
          (value): value is Type<object> =>
            typeof value === 'function' &&
            Reflect.getMetadata(CONTROLLER_WATERMARK, value) === true,
        );
      }),
    )
  ).flat();

const documented = (route: Route): boolean =>
  !(Reflect.getMetadata(DECORATORS.API_EXCLUDE_CONTROLLER, route.controller) ?? []).includes(
    true,
  ) && !Reflect.getMetadata(DECORATORS.API_EXCLUDE_ENDPOINT, route.handler)?.disable;
const swaggerKey = (route: Route, version: '1' | '2') =>
  `${RequestMethod[route.method]} /api/v${version}${route.path.replace(/:([^/]+)/g, '{$1}')}`;
const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;
const documentOperations = (
  document: OpenAPIObject,
): { key: string; operation: NonNullable<OpenAPIObject['paths'][string]['get']> }[] =>
  Object.entries(document.paths).flatMap(([path, item]) =>
    httpMethods.flatMap((method) => {
      const operation = item[method];
      return operation ? [{ key: `${method.toUpperCase()} ${path}`, operation }] : [];
    }),
  );
const operationFor = (document: OpenAPIObject, original: Route, version: '1' | '2') => {
  const key = swaggerKey(original, version);
  const matching = documentOperations(document).filter((entry) => entry.key === key);
  expect(matching.map((entry) => entry.key)).toEqual([key]);
  return matching[0].operation;
};

async function makeSwaggerApp() {
  const tokens = new Set<Type<object> | string | symbol>();
  for (const controller of controllers) {
    const dependencies = [...(Reflect.getMetadata(PARAMTYPES_METADATA, controller) ?? [])];
    for (const dependency of Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, controller) ?? []) {
      dependencies[dependency.index] = dependency.param;
    }
    dependencies.forEach((token) => tokens.add(token));
  }
  const config = new ConfigService({ app: { nodeEnv: 'test' }, usersDb: {} });
  const builder = Test.createTestingModule({
    controllers,
    providers: [...tokens].map((provide) => ({
      provide,
      useValue: provide === ConfigService ? config : Object.create(null),
    })),
  });
  const guards = new Set(routes.flatMap(effectiveGuards));
  for (const guard of guards) builder.overrideGuard(guard).useValue({ canActivate: () => true });
  const module = await builder.compile();
  const app = module.createNestApplication({ logger: false });
  configureApiVersioning(app, 'api/v1');
  try {
    await app.init();
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Route parity').build(),
    );
    return { app, document };
  } catch (error) {
    await app.close();
    throw error;
  }
}

describe('full backend v2 route parity', () => {
  it('inventories all 23 actual controllers, including both diagnostics controllers', async () => {
    expect(controllers).toHaveLength(23);
    expect(new Set(await discoverControllers(resolve(__dirname, '../..')))).toEqual(
      new Set(controllers),
    );
    expect(
      controllers.filter(
        (controller) => Reflect.getMetadata(PATH_METADATA, controller) === 'diagnostics',
      ),
    ).toEqual([DiagnosticsController, EmailDiagnosticsController]);
  });

  it.each(inventory)(
    '$controller.name retains every original unversioned v1 route',
    ({ controller, paths }) => {
      expect(Reflect.getMetadata(VERSION_METADATA, controller)).toBeUndefined();
      expect(
        legacyRoutes
          .filter((route) => route.controller === controller)
          .map(({ key }) => key)
          .sort(),
      ).toEqual([...paths].sort());
    },
  );

  it('retains 133 v1 routes and registers exactly 133 explicit v2 siblings without duplicate method/path keys', () => {
    expect(legacyRoutes).toHaveLength(133);
    expect(v2Routes.map(({ key }) => key).sort()).toEqual(
      legacyRoutes.map(({ key }) => key).sort(),
    );
    expect(new Set(legacyRoutes.map(({ key }) => key)).size).toBe(133);
    expect(new Set(v2Routes.map(({ key }) => key)).size).toBe(133);
    expect(routes).toHaveLength(266);
    expect(routes.filter(({ version }) => version !== undefined && version !== '2')).toEqual([]);
  });

  it('excludes only the original 36 identity-aware reads from alias DTO and delegation checks', () => {
    expect(identityOperationIds.size).toBe(36);
    const identityRoutes = legacyRoutes.filter((route) =>
      identityOperationIds.has(operationId(route) ?? ''),
    );
    expect(identityRoutes).toHaveLength(36);
    expect(new Set(identityRoutes.map(operationId))).toEqual(identityOperationIds);
    for (const original of identityRoutes) {
      expect(original.method).toBe(RequestMethod.GET);
      expect(operationId(counterpart(original))).toBe(`${operationId(original)}_v2`);
    }
    expect(aliases).toHaveLength(97);
  });

  it.each(legacyRoutes)(
    '$key has one explicit sibling and unchanged effective access/envelope annotations',
    (original) => {
      const alias = counterpart(original);
      for (const key of [
        IS_PUBLIC_KEY,
        ROLES_KEY,
        SKIP_INTEGRITY_KEY,
        SKIP_ENVELOPE,
        GUARDS_METADATA,
      ]) {
        expect({ key, value: Reflect.getMetadata(key, alias.handler) }).toEqual({
          key,
          value: Reflect.getMetadata(key, original.handler),
        });
        expect({ key, value: effective(alias, key) }).toEqual({
          key,
          value: effective(original, key),
        });
      }
      expect(effectiveGuards(alias)).toEqual(effectiveGuards(original));
      const originalId = operationId(original);
      if (originalId) expect(operationId(alias)).toBe(`${originalId}_v2`);
    },
  );

  it('retains class-level public, integrity and diagnostics/dev-console guards for both versions', () => {
    const publicControllers = new Set<Type<object>>([ApiLogsController, DevConsoleController]);
    const integrityExempt = new Set<Type<object>>([
      DiagnosticsController,
      DevConsoleController,
      HealthController,
      AppIntegrityController,
    ]);
    const diagnosticsControllers = new Set<Type<object>>([
      DiagnosticsController,
      EmailDiagnosticsController,
      ApiLogsController,
    ]);
    for (const route of routes) {
      if (publicControllers.has(route.controller))
        expect(effective(route, IS_PUBLIC_KEY)).toBe(true);
      if (integrityExempt.has(route.controller))
        expect(effective(route, SKIP_INTEGRITY_KEY)).toBe(true);
      if (diagnosticsControllers.has(route.controller)) {
        expect(effectiveGuards(route)).toEqual([DiagnosticsEnabledGuard]);
      }
      if (route.controller === DevConsoleController) {
        expect(effectiveGuards(route)).toEqual([DevConsoleGuard]);
      }
      if (route.controller === HealthController) {
        expect(effective(route, IS_PUBLIC_KEY)).toBe(true);
        expect(effective(route, SKIP_ENVELOPE)).toBe(true);
        expect(effectiveGuards(route)).toEqual(
          ['/health/db', '/health/users-db', '/health/motc-sms-db'].includes(route.path)
            ? [DiagnosticsEnabledGuard]
            : [],
        );
      }
      if (
        route.controller === NotificationsController &&
        route.path === '/notifications/device-token/test'
      ) {
        expect(effectiveGuards(route)).toEqual([DiagnosticsEnabledGuard]);
      }
    }
  });

  it('keeps pre-auth routes public without making authenticated auth/notification/integrity routes public', () => {
    for (const route of routes) {
      if (route.controller === AuthController) {
        const protectedRoute = ['/auth/me', '/auth/logout'].includes(route.path);
        expect(effective(route, IS_PUBLIC_KEY)).toBe(protectedRoute ? undefined : true);
        expect(effective(route, SKIP_ENVELOPE)).toBe(route.path === '/auth/me' ? undefined : true);
        expect(effective(route, SKIP_INTEGRITY_KEY)).toBeUndefined();
      }
      if (route.controller === HealthCheckController) {
        expect(effective(route, IS_PUBLIC_KEY)).toBe(true);
        expect(effective(route, SKIP_ENVELOPE)).toBe(true);
        expect(effective(route, SKIP_INTEGRITY_KEY)).toBeUndefined();
      }
      if (
        route.controller === NotificationsController ||
        route.controller === AppIntegrityController
      ) {
        expect(effective(route, IS_PUBLIC_KEY)).toBeUndefined();
      }
    }
  });

  it.each(aliases)(
    '$key keeps DTO constructors, argument decorators/pipes and response passthrough',
    (original) => {
      const alias = counterpart(original);
      expect(parameterTypes(alias)).toEqual(parameterTypes(original));
      expect(argumentMetadata(alias)).toEqual(argumentMetadata(original));
      expect(
        Reflect.getMetadata(RESPONSE_PASSTHROUGH_METADATA, alias.controller, alias.name),
      ).toEqual(
        Reflect.getMetadata(RESPONSE_PASSTHROUGH_METADATA, original.controller, original.name),
      );
    },
  );

  it.each(aliases)(
    '$key keeps HTTP status, headers, guards and annotated Swagger request/response metadata',
    (original) => {
      const alias = counterpart(original);
      expect(metadataWithoutRouting(alias)).toEqual(metadataWithoutRouting(original));
      const status = (route: Route) =>
        Reflect.getMetadata(HTTP_CODE_METADATA, route.handler) ??
        (route.method === RequestMethod.POST ? 201 : 200);
      expect(status(alias)).toBe(status(original));
      const operation = Reflect.getMetadata(DECORATORS.API_OPERATION, original.handler);
      if (operation) {
        expect(Reflect.getMetadata(DECORATORS.API_OPERATION, alias.handler)).toEqual({
          ...operation,
          operationId:
            operation.operationId === undefined ? undefined : `${operation.operationId}_v2`,
        });
      }
    },
  );

  it.each(aliases)(
    '$key delegates once with every argument in order and returns the exact original result',
    async (original) => {
      const alias = counterpart(original);
      const instance = Object.create(original.controller.prototype);
      const count = Math.max(
        original.handler.length,
        parameterTypes(original).length,
        ...Object.values(argumentMetadata(original)).map(({ index }) => index + 1),
      );
      const args = Array.from({ length: count }, (_, index) =>
        Object.freeze({ index, route: original.key }),
      );
      const result = Object.freeze({
        route: original.key,
        bytes: Buffer.from([0, 255, 1]),
        nested: { unchanged: true },
      });
      const spy = jest.spyOn(instance, original.name);
      try {
        for (const returnValue of [result, Promise.resolve(result)]) {
          spy.mockReset().mockReturnValue(returnValue);
          expect(await Reflect.apply(alias.handler, instance, args)).toBe(result);
          expect(spy).toHaveBeenCalledTimes(1);
          expect(spy.mock.calls[0]).toHaveLength(args.length);
          spy.mock.calls[0].forEach((argument, index) => expect(argument).toBe(args[index]));
        }
        spy.mockReset().mockReturnValue(undefined);
        expect(await Reflect.apply(alias.handler, instance, args)).toBeUndefined();
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(...args);
        for (const reject of [false, true]) {
          const error = new Error('original handler failure');
          spy.mockReset().mockImplementation(() => {
            if (reject) return Promise.reject(error);
            throw error;
          });
          await expect(
            Promise.resolve().then(() => Reflect.apply(alias.handler, instance, args)),
          ).rejects.toBe(error);
          expect(spy).toHaveBeenCalledTimes(1);
          expect(spy).toHaveBeenCalledWith(...args);
        }
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('uses globally unique explicit operation IDs, including all added _v2 IDs', () => {
    const specified = routes.map(operationId).filter((id): id is string => id !== undefined);
    expect(new Set(specified).size).toBe(specified.length);
  });
});

describe('full backend Swagger registration with inert service providers', () => {
  let app: INestApplication | undefined;
  let document: OpenAPIObject;

  beforeAll(async () => {
    ({ app, document } = await makeSwaggerApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('publishes both versions of all documented endpoints and preserves intentional Swagger exclusions', () => {
    const expected = legacyRoutes
      .filter(documented)
      .flatMap((route) => [swaggerKey(route, '1'), swaggerKey(route, '2')]);
    expect(
      documentOperations(document)
        .map(({ key }) => key)
        .sort(),
    ).toEqual(expected.sort());
    expect(expected).toHaveLength(244);
  });

  it('uses unique generated IDs for originals without operationId and unique explicit _v2 IDs for annotated aliases', () => {
    const operations = documentOperations(document);
    const ids = operations.map(({ operation }) => operation.operationId);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const original of legacyRoutes.filter(documented)) {
      const v1 = operationFor(document, original, '1');
      const v2 = operationFor(document, original, '2');
      expect(v2.operationId).not.toBe(v1.operationId);
      if (operationId(original)) {
        expect(v1.operationId).toBe(operationId(original));
        expect(v2.operationId).toBe(`${operationId(original)}_v2`);
      }
    }
  });

  it.each(aliases.filter(documented))(
    '$key preserves generated request schemas and response documentation',
    (original) => {
      const v1 = operationFor(document, original, '1');
      const v2 = operationFor(document, original, '2');
      for (const key of ['parameters', 'requestBody', 'responses', 'security', 'tags'] as const) {
        expect({ key, value: v2[key] }).toEqual({ key, value: v1[key] });
      }
    },
  );
});
