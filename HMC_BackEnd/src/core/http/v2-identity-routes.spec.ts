import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JwtStrategy } from '../auth/jwt.strategy';
import { TokenRevocationService } from '../auth/token-revocation.service';
import { Role } from '../auth/auth-user.interface';
import { configureApiVersioning, apiVersionPrefix } from './api-versioning';
import { ResponseInterceptor } from './response.interceptor';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { EFFECTIVE_DATE_ALL } from '@shared/utils/date.util';
import { ProfileController } from '@modules/profile/interface/profile.controller';
import { ProfileService } from '@modules/profile/application/profile.service';
import { EmployeeController } from '@modules/employee/interface/employee.controller';
import { EmployeeService, SupervisorService } from '@modules/employee/application/employee.service';
import { PayslipController } from '@modules/payslip/interface/payslip.controller';
import { PayslipService } from '@modules/payslip/application/payslip.service';
import { LeaveController } from '@modules/leave/interface/leave.controller';
import { LeavesController } from '@modules/leave/interface/leaves.controller';
import { LeaveService } from '@modules/leave/application/leave.service';
import { LettersController } from '@modules/letters/interface/letters.controller';
import { LettersService } from '@modules/letters/application/letters.service';
import { IdentityController } from '@modules/identity/interface/identity.controller';
import { QidService, IdCardService } from '@modules/identity/application/identity.service';
import { SchoolFeesController } from '@modules/school-fees/interface/school-fees.controller';
import { SchoolFeeService } from '@modules/school-fees/application/school-fees.service';
import { AppointmentsController } from '@modules/appointments/interface/appointments.controller';
import { AppointmentsService } from '@modules/appointments/application/appointments.service';
import { AnnualTicketController } from '@modules/annual-ticket/interface/annual-ticket.controller';
import { AnnualTicketService } from '@modules/annual-ticket/application/annual-ticket.service';
import { ApprovalsController } from '@modules/approvals/interface/approvals.controller';
import {
  ApprovalsService,
  WorklistService,
} from '@modules/approvals/application/approvals.service';
import { APPROVALS_REPOSITORY } from '@modules/approvals/domain/approvals.repository';
import { LookupsController } from '@lookups/interface/lookups.controller';
import { LookupsService } from '@lookups/application/lookups.service';

const SECRET = 'v2-http-test-secret-not-for-production';
const jwt = new JwtService({ secret: SECRET });
const users = [
  { username: 'Alice.Login', employeeNumber: '000123', person_id: '912345' },
  { username: 'Bob.Login', employeeNumber: '000456', person_id: '978654' },
];
type Claims = (typeof users)[number];
const caller = (u: Claims) =>
  expect.objectContaining({
    username: u.username,
    employeeNumber: u.employeeNumber,
    personId: u.person_id,
  });
const token = (claims: Record<string, unknown> = users[0]) =>
  jwt.sign(
    {
      sub: 'not-an-authoritative-identity',
      roles: [Role.EMPLOYEE],
      ...claims,
    },
    { expiresIn: '5m' },
  );

const services = {
  profile: ProfileService,
  employee: EmployeeService,
  supervisor: SupervisorService,
  payslip: PayslipService,
  leave: LeaveService,
  letters: LettersService,
  qid: QidService,
  idCard: IdCardService,
  school: SchoolFeeService,
  appointments: AppointmentsService,
  annualTicket: AnnualTicketService,
  approvals: ApprovalsService,
  worklist: WorklistService,
  lookups: LookupsService,
};
type ServiceName = keyof typeof services;
type IdentityKey = 'username' | 'enum' | 'person_id' | 'user_name';
interface RouteCase {
  path: string;
  service: ServiceName;
  method: string;
  operationId: string;
  args: (u: Claims) => unknown[];
  query?: Record<string, string>;
  legacyKey?: IdentityKey;
  legacyMethod?: string;
  items?: boolean;
  requiredClaim?: 'employeeNumber' | 'person_id';
  swaggerPath?: string;
}
const routes: RouteCase[] = [
  {
    path: '/profile',
    service: 'profile',
    method: 'getProfile',
    operationId: 'profile_get',
    legacyKey: 'username',
    args: (u) => [u.username, 'en'],
  },
  {
    path: '/profile/notifications',
    service: 'profile',
    method: 'notifications',
    operationId: 'profile_notifications',
    legacyKey: 'username',
    args: (u) => [u.username, 'en'],
  },
  {
    path: '/profile/notifications/summary',
    service: 'profile',
    method: 'notificationSummary',
    operationId: 'profile_notificationSummary',
    legacyKey: 'username',
    query: { notificationId: '901' },
    args: (u) => [u.username, 'en', '901'],
  },
  {
    path: '/employee/employment',
    service: 'employee',
    method: 'employment',
    operationId: 'employee_employment',
    legacyKey: 'username',
    args: (u) => [u.username, 'en'],
  },
  {
    path: '/employee/basic',
    service: 'employee',
    method: 'basic',
    operationId: 'employee_basic',
    legacyKey: 'enum',
    requiredClaim: 'employeeNumber',
    args: (u) => [u.employeeNumber, 'en'],
  },
  {
    path: '/employee/performance',
    service: 'employee',
    method: 'performance',
    operationId: 'employee_performance',
    legacyKey: 'username',
    args: (u) => [u.username, 'en'],
  },
  {
    path: '/employee/supervisor/views',
    service: 'supervisor',
    method: 'views',
    operationId: 'employee_supervisorViews',
    legacyKey: 'username',
    query: { searchKeyWord: 'Other employee' },
    args: (u) => [u.username, 'en', 'Other employee'],
  },
  {
    path: '/payslip/periods',
    service: 'payslip',
    method: 'getPeriods',
    operationId: 'payslip_periods',
    legacyKey: 'username',
    args: (u) => [u.username, 'en'],
  },
  {
    path: '/payslip/count',
    service: 'payslip',
    method: 'checkCount',
    operationId: 'payslip_count',
    legacyKey: 'person_id',
    requiredClaim: 'person_id',
    query: { payslipperiod: 'August 2024' },
    args: (u) => [u.person_id, 'en', 'August 2024'],
  },
  {
    path: '/payslip',
    service: 'payslip',
    method: 'generate',
    operationId: 'payslip_generate',
    legacyKey: 'person_id',
    requiredClaim: 'person_id',
    query: { payperiod: 'January 2024', assignmentid: '7179444713' },
    args: (u) => [u.person_id, 'en', 'January 2024', '7179444713'],
  },
  {
    path: '/leave/balance',
    service: 'leave',
    method: 'getBalance',
    operationId: 'leave_balance',
    legacyKey: 'username',
    args: (u) => [
      {
        username: u.username,
        lang: 'en',
        effectiveDate: EFFECTIVE_DATE_ALL,
        accrualPlan: undefined,
      },
    ],
  },
  {
    path: '/leave/lov/defaults',
    service: 'leave',
    method: 'defaultsForCaller',
    legacyMethod: 'defaults',
    operationId: 'leave_defaults',
    legacyKey: 'enum',
    args: (u) => [caller(u), 'en'],
  },
  {
    path: '/leave/lov/request-lov',
    service: 'leave',
    method: 'requestLovForCaller',
    legacyMethod: 'requestLov',
    operationId: 'leave_requestLov',
    legacyKey: 'enum',
    args: (u) => [caller(u), 'en'],
  },
  {
    path: '/leave/lov/return',
    service: 'leave',
    method: 'returnLovForCaller',
    legacyMethod: 'returnLov',
    operationId: 'leave_returnLov',
    legacyKey: 'username',
    items: true,
    args: (u) => [caller(u), 'en'],
  },
  {
    path: '/leave/lov/return-details',
    service: 'leave',
    method: 'returnDetailsLov',
    operationId: 'leave_returnDetailsLov',
    legacyKey: 'username',
    items: true,
    args: (u) => [u.username],
  },
  {
    path: '/leave/lov/return-related1',
    service: 'leave',
    method: 'relatedLeave1Lov',
    operationId: 'leave_relatedLeave1Lov',
    legacyKey: 'username',
    items: true,
    args: (u) => [u.username],
  },
  {
    path: '/leave/lov/return-related2',
    service: 'leave',
    method: 'relatedLeave2Lov',
    operationId: 'leave_relatedLeave2Lov',
    legacyKey: 'username',
    items: true,
    args: (u) => [u.username],
  },
  {
    path: '/leave/lov/cancel',
    service: 'leave',
    method: 'cancelLovForCaller',
    legacyMethod: 'cancelLov',
    operationId: 'leave_cancelLov',
    legacyKey: 'person_id',
    items: true,
    query: { leave_type: 'Casual Leave' },
    args: (u) => [caller(u), 'en', 'Casual Leave'],
  },
  {
    path: '/leave/lov/amend',
    service: 'leave',
    method: 'amendLovForCaller',
    legacyMethod: 'amendLov',
    operationId: 'leave_amendLov',
    legacyKey: 'person_id',
    items: true,
    query: { leave_type: 'Casual Leave' },
    args: (u) => [caller(u), 'en', 'Casual Leave'],
  },
  {
    path: '/leaves',
    service: 'leave',
    method: 'listLeaves',
    operationId: 'leave_list',
    legacyKey: 'user_name',
    query: { leave_type: 'Annual Leave' },
    args: (u) => [u.username, 'Annual Leave'],
  },
  {
    path: '/letters/lov',
    service: 'letters',
    method: 'getLetterLovsForCaller',
    legacyMethod: 'getLetterLovs',
    operationId: 'letters_lov',
    legacyKey: 'enum',
    args: (u) => ['en', caller(u)],
  },
  {
    path: '/identity/qid',
    service: 'qid',
    method: 'getQid',
    operationId: 'identity_qid',
    legacyKey: 'username',
    args: (u) => [u.username, 'en'],
  },
  {
    path: '/school-fees/lov/schools',
    service: 'school',
    method: 'schoolsLovForCaller',
    legacyMethod: 'schoolsLov',
    operationId: 'schoolFees_schoolsLov',
    legacyKey: 'username',
    items: true,
    query: { search: 'Doha', page: '2', pageSize: '25' },
    args: (u) => ['en', caller(u), { search: 'Doha', offset: 25, limit: 25 }],
  },
  {
    path: '/school-fees/lov/request-type',
    service: 'school',
    method: 'requestTypeLovForCaller',
    legacyMethod: 'requestTypeLov',
    operationId: 'schoolFees_requestTypeLov',
    legacyKey: 'username',
    items: true,
    args: (u) => ['en', caller(u)],
  },
  {
    path: '/school-fees/children',
    service: 'school',
    method: 'children',
    operationId: 'schoolFees_children',
    legacyKey: 'enum',
    query: { acadyrstrtdt: '20250901' },
    args: (u) => [u.username, '20250901', 'en'],
  },
  {
    path: '/appointments/upcoming',
    service: 'appointments',
    method: 'getUpcoming',
    operationId: 'appointments_upcoming',
    legacyKey: 'enum',
    requiredClaim: 'employeeNumber',
    args: (u) => [u.employeeNumber, 'en'],
  },
  {
    path: '/appointments/booking-init',
    service: 'appointments',
    method: 'initBooking',
    operationId: 'appointments_bookingInit',
    legacyKey: 'enum',
    requiredClaim: 'employeeNumber',
    args: (u) => [u.employeeNumber, 'en'],
  },
  {
    path: '/annual-ticket/cancel-options',
    service: 'annualTicket',
    method: 'cancelOptions',
    operationId: 'annualTicket_cancelOptions',
    legacyKey: 'person_id',
    requiredClaim: 'person_id',
    args: (u) => [u.person_id],
  },
  {
    path: '/approvals',
    service: 'approvals',
    method: 'summary',
    operationId: 'approvals_summary',
    legacyKey: 'enum',
    args: (u) => [caller(u), 'en'],
  },
  {
    path: '/approvals/my-requests',
    service: 'approvals',
    method: 'myRequests',
    operationId: 'approvals_myRequests',
    legacyKey: 'username',
    args: (u) => [caller(u), 'en'],
  },
  {
    path: '/approvals/pending-count',
    service: 'approvals',
    method: 'pendingCounts',
    operationId: 'approvals_pendingCount',
    legacyKey: 'username',
    items: true,
    query: { pendreq: ' XXHMC_SND_PNDNG_UPD_PERSON_V ' },
    args: (u) => [caller(u), 'XXHMC_SND_PNDNG_UPD_PERSON_V'],
  },
  {
    path: '/approvals/worklist',
    service: 'worklist',
    method: 'worklist',
    operationId: 'approvals_worklist',
    legacyKey: 'enum',
    args: (u) => [u.username, 'en'],
  },
  {
    path: '/approvals/worklist/summary',
    service: 'worklist',
    method: 'worklistSummary',
    operationId: 'approvals_worklistSummary',
    legacyKey: 'enum',
    query: { notificationId: '901' },
    args: (u) => [u.username, 'en', '901'],
  },
  {
    path: '/approvals/900/details',
    swaggerPath: '/approvals/{id}/details',
    service: 'approvals',
    method: 'details',
    operationId: 'approvals_details',
    legacyKey: 'enum',
    args: (u) => ['900', 'en', caller(u)],
  },
  {
    path: '/approvals/attachments/700',
    swaggerPath: '/approvals/attachments/{documentId}',
    service: 'approvals',
    method: 'attachment',
    operationId: 'approvals_attachment',
    legacyKey: 'username',
    args: (u) => ['700', caller(u)],
  },
  {
    path: '/lookups/lov',
    service: 'lookups',
    method: 'getLovForCaller',
    legacyMethod: 'getLov',
    operationId: 'lookups_lov',
    legacyKey: 'username',
    items: true,
    query: { lovname: 'CONTRACT_YEARS_V' },
    args: (u) => ['CONTRACT_YEARS_V', 'en', caller(u)],
  },
];

const rows = [{ code: '1', meaning: 'Unchanged business row', used_value: '1' }];
const attachment = Object.freeze({
  id: 700,
  fileName: 'a "quoted" file.pdf',
  contentType: 'application/pdf',
  sizeBytes: 6,
  uploadedAt: null,
  url: '/api/v1/approvals/attachments/700',
});
const detail = Object.freeze({ notificationId: '900', attachments: Object.freeze([attachment]) });
const bytes = Buffer.from([0, 255, 80, 68, 70, 10]);
const file = {
  fileName: attachment.fileName,
  contentType: attachment.contentType,
  contentBase64: bytes.toString('base64'),
};

async function makeApp(disabled: boolean, prefix = 'api/v1', realApprovals = false) {
  const mocks = Object.fromEntries(Object.keys(services).map((name) => [name, {}])) as Record<
    ServiceName,
    Record<string, jest.Mock>
  >;
  for (const route of routes) {
    for (const method of [route.method, route.legacyMethod ?? route.method]) {
      mocks[route.service][method] = jest.fn().mockResolvedValue(rows);
    }
  }
  mocks.approvals.details.mockResolvedValue(detail);
  mocks.approvals.attachment.mockResolvedValue(file);
  const config = new ConfigService({
    auth: { disabled, jwtSecret: SECRET },
    app: { apiPrefix: prefix, nodeEnv: 'development' },
  });
  const repo = {
    getSummary: jest.fn().mockResolvedValue({ approvals: [], pendingQid: [] }),
    getMyRequests: jest.fn().mockResolvedValue({ requests: [], pendingQid: [] }),
    getPendingCounts: jest.fn().mockResolvedValue(rows),
    isOwnedBy: jest
      .fn()
      .mockImplementation(async (_id: string, keys: string[]) => keys.includes(users[0].username)),
    itemKeyOfAttachment: jest.fn().mockResolvedValue('800'),
    isItemOwnedBy: jest
      .fn()
      .mockImplementation(async (_id: string, keys: string[]) => keys.includes(users[0].username)),
    getDetails: jest.fn().mockResolvedValue({
      header: {},
      itemKey: '800',
      serviceView: null,
      detailRow: undefined,
      attachments: [attachment],
    }),
    getAttachmentContent: jest.fn().mockResolvedValue(file),
  };
  const module = await Test.createTestingModule({
    imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [
      ProfileController,
      EmployeeController,
      PayslipController,
      LeaveController,
      LeavesController,
      LettersController,
      IdentityController,
      SchoolFeesController,
      AppointmentsController,
      AnnualTicketController,
      ApprovalsController,
      LookupsController,
    ],
    providers: [
      { provide: ConfigService, useValue: config },
      { provide: APPROVALS_REPOSITORY, useValue: repo },
      JwtStrategy,
      JwtAuthGuard,
      TokenRevocationService,
      ...Object.entries(services).map(([name, provide]) =>
        realApprovals && name === 'approvals'
          ? { provide, useClass: ApprovalsService }
          : { provide, useValue: mocks[name as ServiceName] },
      ),
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  configureApiVersioning(app, prefix);
  app.useGlobalGuards(module.get(JwtAuthGuard));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor(module.get(Reflector)));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, mocks, repo, revocation: module.get(TokenRevocationService) };
}
type Harness = Awaited<ReturnType<typeof makeApp>>;
const noBusinessCalls = (h: Harness) => {
  for (const service of Object.values(h.mocks)) {
    for (const mock of Object.values(service)) expect(mock).not.toHaveBeenCalled();
  }
};
const url = (route: RouteCase, version: '1' | '2' = '2', extra = '') => {
  const query = new URLSearchParams(route.query ?? {}).toString();
  return `/api/v${version}${route.path}?${query}${extra ? `&${extra}` : ''}`;
};

for (const disabled of [false, true]) {
  describe(`36 v2 business routes, AUTH_DISABLED=${disabled}`, () => {
    let h: Harness;
    beforeAll(async () => {
      h = await makeApp(disabled);
    });
    afterAll(async () => {
      await h?.app.close();
    });
    beforeEach(() => jest.clearAllMocks());

    it.each(routes)(
      '$path scopes both callers from verified claims and preserves the response',
      async (route) => {
        for (const user of users) {
          jest.clearAllMocks();
          const response = await request(h.app.getHttpServer())
            .get(url(route))
            .auth(token(user), { type: 'bearer' })
            .expect(200);
          expect(h.mocks[route.service][route.method]).toHaveBeenCalledTimes(1);
          expect(h.mocks[route.service][route.method]).toHaveBeenCalledWith(...route.args(user));
          if (route.method === 'attachment') {
            expect(response.body).toEqual(bytes);
            expect(response.headers['content-type']).toBe('application/pdf');
            expect(response.headers['content-length']).toBe(String(bytes.length));
            expect(response.headers['content-disposition']).toBe(
              'inline; filename="a quoted file.pdf"',
            );
          } else {
            expect(response.body).toEqual({
              result:
                route.method === 'details'
                  ? {
                      ...detail,
                      attachments: [{ ...attachment, url: '/api/v2/approvals/attachments/700' }],
                    }
                  : route.items
                    ? { items: rows }
                    : rows,
              opstatus: 0,
              status: 'success',
              httpStatusCode: 200,
            });
          }
        }
        expect(attachment.url).toBe('/api/v1/approvals/attachments/700');
      },
    );

    it.each(routes)('$path preserves the v1 query contract', async (route) => {
      const identity = route.legacyKey ? `${route.legacyKey}=123456` : '';
      const response = await request(h.app.getHttpServer())
        .get(url(route, '1', identity))
        .auth(token(), { type: 'bearer' })
        .expect(200);
      expect(h.mocks[route.service][route.legacyMethod ?? route.method]).toHaveBeenCalledTimes(1);
      if (route.method === 'details') expect(response.body.result).toEqual(detail);
      if (route.method === 'attachment') expect(response.body).toEqual(bytes);
    });

    it.each(routes)(
      '$path rejects all identity-query forms before business calls',
      async (route) => {
        const forms = [
          'username=other',
          'enum=000999',
          'person_id=999',
          'user_name=other',
          'username=one&username=two',
          'enum[]=000999',
          'person_id[id]=999',
          'user_name%5B%5D=other',
          '%75sername=other',
          'user%5Fname=other',
          'username%5Bconstructor%5D=other',
          `${Array.from({ length: 1100 }, () => 'lang=en').join('&')}&username=other`,
        ];
        for (const form of forms) {
          await request(h.app.getHttpServer())
            .get(url(route, '2', form))
            .auth(token(), { type: 'bearer' })
            .expect(400);
          noBusinessCalls(h);
        }
      },
    );

    it.each(routes)(
      '$path rejects absent, expired, bad, revoked and refresh JWTs',
      async (route) => {
        const revoked = token({ ...users[0], jti: 'revoked-v2-session' });
        h.revocation.revoke('revoked-v2-session');
        const invalidTokens = [
          undefined,
          'not.a.jwt',
          jwt.sign(users[0], { expiresIn: -1 }),
          new JwtService({ secret: 'incorrect-secret' }).sign(users[0]),
          token({ ...users[0], typ: 'refresh' }),
          revoked,
        ];
        for (const invalid of invalidTokens) {
          const req = request(h.app.getHttpServer()).get(url(route));
          if (invalid) req.auth(invalid, { type: 'bearer' });
          await req.expect(401);
          noBusinessCalls(h);
        }
      },
    );

    it.each(routes)(
      '$path rejects missing signed username without a sub fallback',
      async (route) => {
        await request(h.app.getHttpServer())
          .get(url(route))
          .auth(token({ sub: 'fallback', employeeNumber: '000123', person_id: '912345' }), {
            type: 'bearer',
          })
          .expect(401);
        noBusinessCalls(h);
      },
    );

    it.each(routes.filter((r) => r.requiredClaim))(
      '$path requires its own employee/person claim before service calls',
      async (route) => {
        const claims: Record<string, unknown> = { ...users[0], sub: '111111', enum: '222222' };
        delete claims[route.requiredClaim!];
        const response = await request(h.app.getHttpServer())
          .get(url(route))
          .auth(token(claims), { type: 'bearer' })
          .expect(422);
        expect(JSON.stringify(response.body)).toContain(route.requiredClaim);
        expect(JSON.stringify(response.body)).toMatch(/log in again/i);
        noBusinessCalls(h);
      },
    );

    it('allows old username-only tokens on username-scoped reads, not a manufactured employee number', async () => {
      const old = token({ username: users[0].username, sub: '999999', enum: '888888' });
      for (const path of [
        '/profile',
        '/employee/employment',
        '/payslip/periods',
        '/leave/balance',
        '/identity/qid',
        '/approvals/worklist',
      ]) {
        await request(h.app.getHttpServer())
          .get(`/api/v2${path}`)
          .auth(old, { type: 'bearer' })
          .expect(200);
      }
      await request(h.app.getHttpServer())
        .get('/api/v2/approvals')
        .auth(old, { type: 'bearer' })
        .expect(200);
      expect(h.mocks.approvals.summary).toHaveBeenCalledWith(
        expect.objectContaining({
          username: users[0].username,
          employeeNumber: undefined,
          personId: undefined,
        }),
        'en',
      );
    });

    it('retains business defaults, optional filters and Arabic language', async () => {
      const get = (path: string) =>
        request(h.app.getHttpServer())
          .get(`/api/v2${path}`)
          .auth(token(), { type: 'bearer' })
          .expect(200);
      await get('/school-fees/lov/schools');
      expect(h.mocks.school.schoolsLovForCaller).toHaveBeenCalledWith('en', caller(users[0]), {
        search: undefined,
        offset: 0,
        limit: 100,
      });
      await get('/profile/notifications/summary?lang=ar');
      expect(h.mocks.profile.notificationSummary).toHaveBeenCalledWith(
        users[0].username,
        'ar',
        undefined,
      );
      await get('/approvals/worklist/summary?lang=ar');
      expect(h.mocks.worklist.worklistSummary).toHaveBeenCalledWith(
        users[0].username,
        'ar',
        undefined,
      );
      await get('/leave/balance?accurlpln=42&effectivedate=20260901&lang=ar');
      expect(h.mocks.leave.getBalance).toHaveBeenCalledWith({
        username: users[0].username,
        lang: 'ar',
        accrualPlan: '42',
        effectiveDate: '20260901',
      });
      await get('/leaves');
      expect(h.mocks.leave.listLeaves).toHaveBeenCalledWith(users[0].username, undefined);
    });

    it.each([
      '/payslip/count',
      '/payslip/count?payslipperiod=bad',
      '/payslip?payperiod=January%202024',
      '/school-fees/children?acadyrstrtdt=bad',
      '/school-fees/lov/schools?page=0',
      '/school-fees/lov/schools?pageSize=201',
      '/school-fees/lov/schools?page=abc',
      '/approvals/pending-count?pendreq=%20',
      '/lookups/lov',
      '/profile?lang=fr',
      '/profile?unknown=value',
    ])('retains strict validation for %s', async (path) => {
      await request(h.app.getHttpServer())
        .get(`/api/v2${path}`)
        .auth(token(), { type: 'bearer' })
        .expect(400);
      noBusinessCalls(h);
    });

    it('preserves legacy identity inputs and the development bypass only on v1', async () => {
      await request(h.app.getHttpServer())
        .get('/api/v1/profile?username=LEGACY_OTHER')
        .auth(token(), { type: 'bearer' })
        .expect(200);
      expect(h.mocks.profile.getProfile).toHaveBeenCalledWith('LEGACY_OTHER', 'en');
      await request(h.app.getHttpServer())
        .get('/api/v1/approvals?enum=LEGACY_OTHER')
        .auth(token(), { type: 'bearer' })
        .expect(200);
      expect(h.mocks.approvals.summary).toHaveBeenCalledWith(
        expect.anything(),
        'en',
        'LEGACY_OTHER',
      );
      await request(h.app.getHttpServer())
        .get('/api/v1/profile?username=LEGACY_OTHER')
        .expect(disabled ? 200 : 401);
    });

    it('preserves the 36 specialized v2 GET operations alongside the remaining v2 routes', () => {
      const doc = SwaggerModule.createDocument(
        h.app,
        new DocumentBuilder().addBearerAuth().build(),
      );
      const scopedIds = new Set(routes.map((route) => `${route.operationId}_v2`));
      const v2 = Object.entries(doc.paths).filter(
        ([path, item]) => path.startsWith('/api/v2/') && scopedIds.has(item.get?.operationId ?? ''),
      );
      expect(v2).toHaveLength(36);
      const operationIds = new Set<string>();
      for (const route of routes) {
        const suffix = route.swaggerPath ?? route.path;
        const v1 = doc.paths[`/api/v1${suffix}`].get!;
        const v2Path = doc.paths[`/api/v2${suffix}`];
        const operation = v2Path.get!;
        expect(Object.keys(v2Path)).toEqual(['get']);
        expect(v1.operationId).toBe(route.operationId);
        expect(operation.operationId).toBe(`${route.operationId}_v2`);
        operationIds.add(operation.operationId!);
        expect(operation.responses).toEqual(v1.responses);
        const queryNames = (operation.parameters ?? [])
          .filter((p) => 'in' in p && p.in === 'query')
          .map((p) => ('name' in p ? p.name : ''));
        for (const key of ['username', 'enum', 'person_id', 'user_name'])
          expect(queryNames).not.toContain(key);
        if (route.legacyKey)
          expect(v1.parameters).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ in: 'query', name: route.legacyKey }),
            ]),
          );
      }
      expect(operationIds.size).toBe(36);
    });
  });
}

describe('v2 approval ownership and versioned attachment presentation', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeApp(true, 'custom/mobile/v1', true);
  });
  afterAll(async () => {
    await h?.app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it('passes only original caller keys to the existing ownership and summary services', async () => {
    for (const u of users) {
      for (const path of ['/approvals', '/approvals/my-requests']) {
        await request(h.app.getHttpServer())
          .get(`/custom/mobile/v2${path}`)
          .auth(token(u), { type: 'bearer' })
          .expect(200);
      }
      expect(h.repo.getSummary).toHaveBeenLastCalledWith([u.username, u.employeeNumber], 'en');
      expect(h.repo.getMyRequests).toHaveBeenLastCalledWith([u.username, u.employeeNumber], 'en');
      await request(h.app.getHttpServer())
        .get('/custom/mobile/v2/approvals/pending-count?pendreq=SomeRequest')
        .auth(token(u), { type: 'bearer' })
        .expect(200);
      expect(h.repo.getPendingCounts).toHaveBeenLastCalledWith(u.username, 'SomeRequest');
    }
  });

  it('preserves detail/download ownership and binary headers without mutating v1 attachment links', async () => {
    const own = await request(h.app.getHttpServer())
      .get('/custom/mobile/v2/approvals/900/details')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    const link = own.body.result.attachments[0].url;
    expect(link).toBe('/custom/mobile/v2/approvals/attachments/700');
    expect(h.repo.isOwnedBy).toHaveBeenCalledWith('900', [
      users[0].username,
      users[0].employeeNumber,
    ]);
    const download = await request(h.app.getHttpServer())
      .get(link)
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(download.body).toEqual(bytes);
    expect(download.headers['content-disposition']).toBe('inline; filename="a quoted file.pdf"');
    expect(h.repo.isItemOwnedBy).toHaveBeenCalledWith('800', [
      users[0].username,
      users[0].employeeNumber,
    ]);
    jest.clearAllMocks();
    await request(h.app.getHttpServer())
      .get('/custom/mobile/v2/approvals/900/details')
      .auth(token(users[1]), { type: 'bearer' })
      .expect(403);
    await request(h.app.getHttpServer())
      .get(link)
      .auth(token(users[1]), { type: 'bearer' })
      .expect(403);
    expect(h.repo.getDetails).not.toHaveBeenCalled();
    expect(h.repo.getAttachmentContent).not.toHaveBeenCalled();
    expect(attachment.url).toBe('/api/v1/approvals/attachments/700');
    const legacy = await request(h.app.getHttpServer())
      .get('/custom/mobile/v1/approvals/900/details')
      .auth(token(), { type: 'bearer' })
      .expect(200);
    expect(legacy.body.result.attachments[0]).toEqual(attachment);
  });

  it('never widens ownership with non-production act-as query parameters', async () => {
    for (const path of [
      '/approvals',
      '/approvals/my-requests',
      '/approvals/900/details',
      '/approvals/attachments/700',
    ]) {
      await request(h.app.getHttpServer())
        .get(`/custom/mobile/v2${path}?enum=${users[0].employeeNumber}`)
        .auth(token(users[1]), { type: 'bearer' })
        .expect(400);
    }
    expect(h.repo.getSummary).not.toHaveBeenCalled();
    expect(h.repo.getMyRequests).not.toHaveBeenCalled();
    expect(h.repo.isOwnedBy).not.toHaveBeenCalled();
    expect(h.repo.isItemOwnedBy).not.toHaveBeenCalled();
  });

  it.each(['custom/mobile/v1', 'legacy/mobile'])(
    'serves v1 unchanged and v2 links under prefix %s',
    async (prefix) => {
      const app = await makeApp(true, prefix);
      try {
        const v2Prefix = apiVersionPrefix(prefix, '2');
        const response = await request(app.app.getHttpServer())
          .get(`/${v2Prefix}/approvals/900/details`)
          .auth(token(), { type: 'bearer' })
          .expect(200);
        expect(response.body.result.attachments[0].url).toBe(
          `/${v2Prefix}/approvals/attachments/700`,
        );
        await request(app.app.getHttpServer())
          .get(`/${prefix}/profile?username=LEGACY`)
          .expect(200);
      } finally {
        await app.app.close();
      }
    },
  );
});
