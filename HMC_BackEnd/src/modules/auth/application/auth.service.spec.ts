import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { AuthStateService, SessionState } from '@core/auth/auth-state.service';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ResponseInterceptor } from '@core/http/response.interceptor';
import { AuthController } from '../interface/auth.controller';
import { OnboardingService } from './onboarding.service';
import { MpinService } from './mpin.service';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Role } from '@core/auth/auth-user.interface';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { AuditService } from '@core/audit/audit.service';
import { TokenRevocationService } from '@core/auth/token-revocation.service';
import { AuthService } from './auth.service';
import { MpinStorePort } from '../domain/ports/mpin-store.port';
import { LdapUserPort } from '../domain/ports/ldap-user.port';
import { FunctionAccessPort } from '../domain/ports/function-access.port';
import { DeviceRegistryPort } from '../domain/ports/device-registry.port';
import { LoginEmploymentPort } from '../domain/ports/login-employment.port';
import { OracleService } from '@core/database/oracle.service';
import { OracleLoginEmploymentRepository } from '../infrastructure/adapters/oracle-login-employment.repository';
import { FunctionAccess, FunctionStatus } from '../domain/auth-identity';
import { DEV_FUNCTION_ACCESS } from './dev-fallback';
import { STATIC_FUNCTION_ACCESS } from './static-login.data';
import { OracleUserValidationPort } from '../domain/ports/oracle-user-validation.port';
import { OracleUserValidationRepository } from '../infrastructure/adapters/oracle-user-validation.repository';

const AUTH_CFG = {
  jwtSecret: 'test_secret_test_secret_test_secret_12',
  jwtIssuer: 'sanaad',
  jwtAudience: 'sanaad-b2e',
  jwtExpiresIn: '1h',
  jwtRefreshExpiresIn: '7d',
  disabled: false,
  staticLogin: false,
  functionAccessView: 'HMC_Sanad_AppMaster_VW',
  functionAccessAppId: 1,
};

function makeService(overrides: Partial<typeof AUTH_CFG> = {}, identityUsername = 'hmc1') {
  const authCfg = { ...AUTH_CFG, ...overrides };
  const jwt = new JwtService({
    secret: authCfg.jwtSecret,
    signOptions: { expiresIn: authCfg.jwtExpiresIn as JwtSignOptions['expiresIn'] },
  });
  const mpinStore = { verify: jest.fn().mockResolvedValue(true) } as unknown as MpinStorePort;
  const ldap = {
    validate: jest.fn().mockResolvedValue({
      username: identityUsername,
      employeeNumber: '037400',
      employeeName: 'Test User',
      isEmployee: true,
      isNewUser: false,
      roles: [Role.EMPLOYEE],
    }),
  } as unknown as LdapUserPort;
  const functionAccess = { list: jest.fn().mockResolvedValue([]) } as unknown as FunctionAccessPort;
  const devices = {
    bind: jest.fn(),
    isBound: jest.fn(),
    find: jest.fn(),
    touch: jest.fn().mockResolvedValue(undefined),
  } as unknown as DeviceRegistryPort;
  const employment: jest.Mocked<LoginEmploymentPort> = {
    resolve: jest.fn().mockResolvedValue({}),
  };
  const oracleUser: jest.Mocked<OracleUserValidationPort> = {
    validate: jest.fn().mockResolvedValue(true),
  };
  const audit = { lifecycle: jest.fn() } as unknown as AuditService;
  const revocation = new TokenRevocationService();
  const config = {
    get: jest.fn((key: string, dflt?: unknown) =>
      key === 'auth.disabled' ? authCfg.disabled : dflt,
    ),
    getOrThrow: jest.fn(() => authCfg),
  } as unknown as ConfigService;
  const sessions = new Map<string, SessionState>();
  const state = {
    limit: jest.fn().mockResolvedValue(undefined),
    newSession: AuthStateService.prototype.newSession,
    createSession: jest.fn(async (session: SessionState) => {
      sessions.set(session.sid, { ...session });
    }),
    sessionActive: jest.fn(async (sid: string) => sessions.has(sid)),
    rotateSession: jest.fn(async (session: SessionState, previous: string) => {
      if (sessions.get(session.sid)?.refreshId !== previous) {
        sessions.delete(session.sid);
        throw new UnauthorizedException('Revoked session');
      }
      sessions.set(session.sid, { ...session });
    }),
    revokeSession: jest.fn(async (sid: string) => {
      sessions.delete(sid);
    }),
  } as unknown as jest.Mocked<AuthStateService>;
  const service = new AuthService(
    jwt,
    mpinStore,
    ldap,
    functionAccess,
    devices,
    employment,
    oracleUser,
    audit,
    revocation,
    config,
    state,
  );
  return {
    service,
    jwt,
    revocation,
    state,
    devices,
    ldap,
    mpinStore,
    employment,
    functionAccess,
    oracleUser,
  };
}

const LOGIN = {
  username: 'hmc1',
  mpin: '123456',
  imeinumber: 'imei-1',
  platform: 'iOS',
  appname: 'Sanaad',
  version: '1.0.0',
};

describe('Login invalid-credentials language over HTTP', () => {
  let app: INestApplication;
  const arabic = 'البيانات المدخله غير صحيحه.';
  const english = 'Invalid credentials.';

  beforeAll(async () => {
    const { service, mpinStore } = makeService();
    jest.mocked(mpinStore.verify).mockResolvedValue(false);
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: service },
        { provide: OnboardingService, useValue: {} },
        { provide: MpinService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['ar', undefined, arabic],
    ['en', undefined, english],
    [undefined, 'ar', arabic],
    [undefined, 'en', english],
    ['ar', 'en', arabic],
    ['en', 'ar', english],
    [undefined, undefined, english],
    ['unsupported', 'ar', english],
    [undefined, 'unsupported', english],
  ] as const)(
    'localizes invalid credentials (query=%s, header=%s)',
    async (queryLang, headerLang, message) => {
      const req = request(app.getHttpServer()).post('/api/v1/auth/login');
      if (queryLang !== undefined) req.query({ lang: queryLang });
      if (headerLang !== undefined) req.set('lang', headerLang);

      await req.send(LOGIN).expect(200).expect({ status: 'error', message });
    },
  );
});

describe('AuthService Oracle user validation', () => {
  const functions: FunctionAccess[] = [
    { functionname: 'Payslip', functioncode: 'frmPayslip', status: FunctionStatus.ENABLED },
    {
      functionname: 'Housing',
      functioncode: 'frmHousing',
      remarks: 'Housing',
      status: FunctionStatus.ENABLED,
    },
    {
      functionname: 'Staff clinic',
      functioncode: 'frmStaffclinic',
      status: FunctionStatus.DISABLED,
    },
    { functionname: 'Sogha', functioncode: 'frmSogha', status: FunctionStatus.ENABLED },
    { functionname: 'Banner', functioncode: 'flxbanner', status: FunctionStatus.COMING_SOON },
    { functionname: 'Approvals', functioncode: 'frmApprovals', status: FunctionStatus.ENABLED },
  ];
  const restricted = functions.slice(1, 5);
  const restrictedClaims = ['frmHousing', 'frmSogha'];

  it('validates the request username and preserves the full list when Oracle returns YES', async () => {
    const { service, functionAccess, oracleUser, jwt } = makeService({}, 'resolved-user');
    const ora = {
      isConfigured: jest.fn().mockReturnValue(true),
      call: jest.fn().mockResolvedValue({ p_is_valid: 'YES' }),
    };
    const repository = new OracleUserValidationRepository(ora as unknown as OracleService);
    oracleUser.validate.mockImplementation((username) => repository.validate(username));
    jest.mocked(functionAccess.list).mockResolvedValue(functions);

    const response = await service.login(LOGIN);

    expect(response).toMatchObject({ status: 'success', isOrcaleUser: true });
    expect(response.functionaccesslist).toBe(functions);
    expect(oracleUser.validate).toHaveBeenCalledTimes(1);
    expect(oracleUser.validate).toHaveBeenCalledWith(LOGIN.username);
    expect(functionAccess.list).toHaveBeenCalledWith('037400');
    for (const token of [response.token!, response.refreshtoken!]) {
      expect(jwt.verify(token)).toMatchObject({
        functions: ['frmPayslip', ...restrictedClaims, 'frmApprovals'],
      });
    }
  });

  it.each(['false', 'unavailable', 'timeout', 'disabled'])(
    'restricts the list and both JWTs when Oracle is %s',
    async (result) => {
      const { service, functionAccess, oracleUser, jwt } = makeService();
      const ora = {
        isConfigured: jest.fn().mockReturnValue(result !== 'disabled'),
        call:
          result === 'unavailable' || result === 'timeout'
            ? jest.fn().mockRejectedValue(new Error(result))
            : jest.fn().mockResolvedValue({ p_is_valid: 'false' }),
      };
      const repository = new OracleUserValidationRepository(ora as unknown as OracleService);
      oracleUser.validate.mockImplementation((username) => repository.validate(username));
      jest.mocked(functionAccess.list).mockResolvedValue(functions);

      const response = await service.login(LOGIN);

      expect(response).toMatchObject({
        status: 'success',
        isOrcaleUser: false,
        functionaccesslist: restricted,
      });
      expect(functions).toHaveLength(6);
      for (const token of [response.token!, response.refreshtoken!]) {
        expect(jwt.verify(token)).toMatchObject({ functions: restrictedClaims });
      }
      const refreshed = await service.refresh({ refreshtoken: response.refreshtoken! });
      for (const token of [refreshed.token!, refreshed.refreshtoken!]) {
        expect(jwt.verify(token)).toMatchObject({ functions: restrictedClaims });
      }
    },
  );

  it('does not synthesize missing functions for a non-Oracle user', async () => {
    const { service, oracleUser } = makeService();
    oracleUser.validate.mockResolvedValue(false);

    await expect(service.login(LOGIN)).resolves.toMatchObject({
      status: 'success',
      isOrcaleUser: false,
      functionaccesslist: [],
    });
  });

  it('does not validate Oracle or read function access after an invalid MPIN', async () => {
    const { service, mpinStore, oracleUser, functionAccess } = makeService();
    jest.mocked(mpinStore.verify).mockResolvedValue(false);

    await expect(service.login(LOGIN)).resolves.toEqual({
      status: 'error',
      message: 'Invalid credentials.',
    });
    expect(oracleUser.validate).not.toHaveBeenCalled();
    expect(functionAccess.list).not.toHaveBeenCalled();
  });

  it.each([
    [{ disabled: true }, DEV_FUNCTION_ACCESS],
    [{ staticLogin: true }, STATIC_FUNCTION_ACCESS],
  ] as const)('preserves database-free test bypass %j', async (overrides, expected) => {
    const { service, oracleUser, functionAccess } = makeService(overrides);

    await expect(service.login(LOGIN)).resolves.toMatchObject({
      status: 'success',
      isOrcaleUser: true,
      functionaccesslist: expected,
    });
    expect(oracleUser.validate).not.toHaveBeenCalled();
    expect(functionAccess.list).not.toHaveBeenCalled();
  });
});

describe('AuthService login employeeusername casing', () => {
  it.each(['aibrahim39', 'AiBrAhIm39', 'AIBRAHIM39'])(
    'uppercases the resolved employee username %s without changing authentication inputs',
    async (identityUsername) => {
      const { service, ldap, mpinStore, jwt } = makeService({}, identityUsername);

      const response = await service.login(LOGIN);

      expect(response.status).toBe('success');
      expect(response.employeeusername).toBe('AIBRAHIM39');
      expect(ldap.validate).toHaveBeenCalledWith(
        expect.objectContaining({ username: LOGIN.username }),
      );
      expect(mpinStore.verify).toHaveBeenCalledWith(
        expect.objectContaining({ username: LOGIN.username, mpin: LOGIN.mpin }),
      );
      expect(jwt.decode(response.token!)).toMatchObject({ username: identityUsername });
    },
  );

  it.each(['aibrahim39', 'AiBrAhIm39'])(
    'uppercases the dev login response for %s',
    async (username) => {
      const { service, ldap } = makeService({ disabled: true });

      const response = await service.login({ ...LOGIN, username });

      expect(response.employeeusername).toBe('AIBRAHIM39');
      expect(ldap.validate).not.toHaveBeenCalled();
    },
  );

  it('keeps the static response and embedded userdata employeeusername uppercase', async () => {
    const { service, jwt } = makeService({ staticLogin: true });

    const response = await service.login(LOGIN);

    expect(response.employeeusername).toBe('AIBRAHIM39');
    for (const token of [response.token!, response.refreshtoken!]) {
      expect(jwt.decode(token)).toMatchObject({ userdata: { employeeusername: 'AIBRAHIM39' } });
    }
  });
});

describe('AuthService bilingual login details', () => {
  const identity = {
    username: 'hmc1',
    employeeNumber: '037400',
    employeeName: 'Test Employee',
    employeeNameAr: 'موظف تجريبي',
    facility: 'SQL facility name',
    jobName: 'SQL job name',
    isEmployee: true,
    isNewUser: false,
  };

  it('returns both employee names and lowercase bilingual employment-view fields', async () => {
    const { service, ldap, employment, jwt } = makeService();
    const ora = {
      isConfigured: jest.fn().mockReturnValue(true),
      query: jest.fn().mockResolvedValue([
        {
          JOB: 'Oracle job',
          JOB_AR: 'المسمى الوظيفي',
          ORG: 'Oracle organization',
          ORG_AR: 'المؤسسة',
        },
      ]),
    };
    const repository = new OracleLoginEmploymentRepository(ora as unknown as OracleService);
    jest.mocked(ldap.validate).mockResolvedValueOnce(identity);
    employment.resolve.mockImplementation((employee) => repository.resolve(employee));

    const response = await service.login(LOGIN);

    expect(response).toMatchObject({
      status: 'success',
      employeeusername: 'HMC1',
      employeenumber: '037400',
      employeename: 'Test Employee',
      employeenamear: 'موظف تجريبي',
      job_title: 'Oracle job',
      job_title_ar: 'المسمى الوظيفي',
      organization_name: 'Oracle organization',
      organization_name_ar: 'المؤسسة',
    });
    expect(employment.resolve).toHaveBeenCalledWith(identity);
    expect(ora.query).toHaveBeenCalledTimes(1);
    expect(ora.query).toHaveBeenCalledWith(
      "SELECT REGEXP_SUBSTR(DEPARTMENT, '[^.]+$') AS ORG, " +
        "REGEXP_SUBSTR(DEPARTMENT_AR, '^[^.]+') AS ORG_AR, " +
        "REGEXP_SUBSTR(JOB, '[^.]+', 1, 2) AS JOB, " +
        "REGEXP_SUBSTR(JOB_AR, '[^.]+', 1, 2) AS JOB_AR, " +
        'USER_NAME FROM APPS.XXHMC_SND_EMPLOYMENT_DETAILS_V ' +
        'WHERE USER_NAME = :username AND ROWNUM <= 1',
      { username: 'HMC1' },
    );
    expect(jwt.decode(response.token!)).toMatchObject({ username: 'hmc1', name: 'Test Employee' });
    expect(response).not.toHaveProperty('JOB_TITLE');
    expect(response).not.toHaveProperty('ORGANIZATION_NAME');
  });

  it('issues tokens with SQL fallbacks when the Oracle employment lookup fails', async () => {
    const { service, ldap, employment, jwt } = makeService();
    const ora = {
      isConfigured: jest.fn().mockReturnValue(true),
      query: jest.fn().mockRejectedValue(new Error('Oracle unavailable')),
    };
    const repository = new OracleLoginEmploymentRepository(ora as unknown as OracleService);
    jest.mocked(ldap.validate).mockResolvedValueOnce(identity);
    employment.resolve.mockImplementation((employee) => repository.resolve(employee));

    const response = await service.login(LOGIN);

    expect(response).toMatchObject({
      status: 'success',
      employeename: identity.employeeName,
      employeenamear: identity.employeeNameAr,
      job_title: identity.jobName,
      job_title_ar: identity.jobName,
      organization_name: identity.facility,
      organization_name_ar: identity.facility,
    });
    expect(ora.query).toHaveBeenCalledTimes(1);
    expect(jwt.verify(response.token!)).toMatchObject({ username: 'hmc1' });
    expect(jwt.verify(response.refreshtoken!)).toMatchObject({ username: 'hmc1', typ: 'refresh' });
  });

  it('does not look up employment details when MPIN verification fails', async () => {
    const { service, mpinStore, ldap, employment } = makeService();
    jest.mocked(mpinStore.verify).mockResolvedValueOnce(false);

    await expect(service.login(LOGIN)).resolves.toEqual({
      status: 'error',
      message: 'Invalid credentials.',
    });
    expect(ldap.validate).not.toHaveBeenCalled();
    expect(employment.resolve).not.toHaveBeenCalled();
  });

  it.each([{ disabled: true }, { staticLogin: true }])(
    'does not query Oracle in bypass mode %j',
    async (overrides) => {
      const { service, employment } = makeService(overrides);

      await expect(service.login(LOGIN)).resolves.toMatchObject({ status: 'success' });
      expect(employment.resolve).not.toHaveBeenCalled();
    },
  );
});

describe('AuthService refresh + logout', () => {
  it('login issues an access + refresh pair with jti/typ claims', async () => {
    const { service, jwt } = makeService();
    const res = await service.login(LOGIN);

    expect(res.status).toBe('success');
    const access = jwt.decode<Record<string, unknown>>(res.token!);
    const refresh = jwt.decode<Record<string, unknown>>(res.refreshtoken!);
    expect(access.jti).toBeDefined();
    expect(access.typ).toBe('access');
    expect(access.sid).toBe(refresh.sid);
    expect(access).toMatchObject({ iss: 'sanaad', aud: 'sanaad-b2e' });
    expect(refresh.typ).toBe('refresh');
    expect(refresh.jti).toBeDefined();
    expect(refresh.jti).not.toBe(access.jti);
    for (const claims of [access, refresh]) {
      expect(claims).toMatchObject({
        deviceImei: 'imei-1',
        appName: 'Sanaad',
        appVersion: '1.0.0',
        platform: 'iOS',
      });
      expect(claims).not.toHaveProperty('mpin');
    }
  });

  it('refresh exchanges a valid refresh token for a new pair and rotates it', async () => {
    const { service, jwt } = makeService();
    const login = await service.login(LOGIN);

    const refreshed = await service.refresh({ refreshtoken: login.refreshtoken! });
    expect(refreshed.status).toBe('success');
    expect(refreshed.token).toBeDefined();
    expect(refreshed.refreshtoken).toBeDefined();
    expect(jwt.decode(refreshed.token!)).toMatchObject({
      deviceImei: 'imei-1',
      appName: 'Sanaad',
      appVersion: '1.0.0',
    });

    // One-time use: the same refresh token is now revoked.
    const replay = await service.refresh({ refreshtoken: login.refreshtoken! });
    expect(replay.status).toBe('error');
  });

  it('refresh rejects an access token used as a refresh token', async () => {
    const { service } = makeService();
    const login = await service.login(LOGIN);

    const res = await service.refresh({ refreshtoken: login.token! });
    expect(res.status).toBe('error');
    expect(res.message).toContain('Not a refresh token');
  });

  it('refresh rejects garbage tokens', async () => {
    const { service } = makeService();
    const res = await service.refresh({ refreshtoken: 'not-a-jwt' });
    expect(res.status).toBe('error');
  });

  it('logout revokes the access jti and the provided refresh token', async () => {
    const { service, jwt, revocation } = makeService();
    const login = await service.login(LOGIN);
    const access = jwt.decode<{ jti: string; exp: number }>(login.token!);
    const refresh = jwt.decode<{ jti: string }>(login.refreshtoken!);

    const user = {
      username: 'hmc1',
      roles: [Role.EMPLOYEE],
      claims: access,
    } as unknown as AuthenticatedUser;
    const res = await service.logout(user, { refreshtoken: login.refreshtoken });

    expect(res.status).toBe('success');
    expect(revocation.isRevoked(access.jti)).toBe(true);
    expect(revocation.isRevoked(refresh.jti)).toBe(true);
  });

  it('logout revokes the persisted session family without a supplied refresh token', async () => {
    const { service, jwt, state } = makeService();
    const login = await service.login(LOGIN);
    const claims = jwt.decode<Record<string, unknown>>(login.token!);
    await service.logout({ username: 'hmc1', roles: [Role.EMPLOYEE], claims }, {});
    expect(state.revokeSession).toHaveBeenCalledWith(claims.sid, 'hmc1');
    await expect(service.refresh({ refreshtoken: login.refreshtoken! })).resolves.toMatchObject({
      status: 'error',
    });
  });

  it('refuses a non-employee after MPIN verification and before issuing a session', async () => {
    const { service, ldap, state } = makeService();
    jest
      .mocked(ldap.validate)
      .mockResolvedValue({ username: 'hmc1', isEmployee: false, isNewUser: false });
    await expect(service.login(LOGIN)).resolves.toMatchObject({ status: 'error' });
    expect(state.createSession).not.toHaveBeenCalled();
  });

  it('rechecks employee eligibility before rotating a refresh token', async () => {
    const { service, ldap, state } = makeService();
    const login = await service.login(LOGIN);
    jest
      .mocked(ldap.validate)
      .mockResolvedValue({ username: 'hmc1', isEmployee: false, isNewUser: false });
    await expect(service.refresh({ refreshtoken: login.refreshtoken! })).resolves.toMatchObject({
      status: 'error',
    });
    expect(state.rotateSession).not.toHaveBeenCalled();
    expect(state.revokeSession).toHaveBeenCalled();
  });

  it('logout succeeds even without claims or refresh token', async () => {
    const { service } = makeService();
    const user = { username: 'hmc1', roles: [Role.EMPLOYEE] } as AuthenticatedUser;
    await expect(service.logout(user, {})).resolves.toMatchObject({ status: 'success' });
  });
});
