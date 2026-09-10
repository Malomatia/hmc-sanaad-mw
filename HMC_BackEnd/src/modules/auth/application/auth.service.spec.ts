import { ConfigService } from '@nestjs/config';
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
  const audit = { lifecycle: jest.fn() } as unknown as AuditService;
  const revocation = new TokenRevocationService();
  const config = {
    get: jest.fn((key: string, dflt?: unknown) =>
      key === 'auth.disabled' ? authCfg.disabled : dflt,
    ),
    getOrThrow: jest.fn(() => authCfg),
  } as unknown as ConfigService;
  const personIdentity = { findPersonId: jest.fn().mockResolvedValue('26023') };
  const service = new AuthService(
    jwt,
    mpinStore,
    ldap,
    functionAccess,
    devices,
    audit,
    revocation,
    config,
    personIdentity,
  );
  return { service, jwt, revocation, devices, ldap, mpinStore, personIdentity };
}

const LOGIN = {
  username: 'hmc1',
  mpin: '123456',
  imeinumber: 'imei-1',
  platform: 'iOS',
  appname: 'Sanaad',
  version: '1.0.0',
};

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

describe('AuthService Oracle identity enrichment', () => {
  it.each([{}, { disabled: true }, { staticLogin: true }])(
    'adds PERSON_ID before signing in mode %j and preserves it on refresh', async (mode) => {
      const { service, jwt, personIdentity } = makeService(mode, 'resolved.User');
      const login = await service.login(LOGIN);
      const username = 'staticLogin' in mode ? 'AIBRAHIM39' : 'disabled' in mode ? LOGIN.username : 'resolved.User';
      expect(personIdentity.findPersonId).toHaveBeenCalledWith(username);
      for (const token of [login.token!, login.refreshtoken!]) {
        expect(jwt.verify(token)).toMatchObject({ username, person_id: '26023' });
      }
      const refreshed = await service.refresh({ refreshtoken: login.refreshtoken! });
      for (const token of [refreshed.token!, refreshed.refreshtoken!]) {
        expect(jwt.verify(token)).toMatchObject({ person_id: '26023' });
      }
      expect(personIdentity.findPersonId).toHaveBeenCalledTimes(1);
    },
  );

  it('does not query Oracle for invalid credentials', async () => {
    const { service, mpinStore, personIdentity } = makeService();
    (mpinStore.verify as jest.Mock).mockResolvedValue(false);
    expect(await service.login(LOGIN)).toEqual({ status: 'error', message: 'Invalid credentials.' });
    expect(personIdentity.findPersonId).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'missing', 'invalid'])('allows partial login when PERSON_ID is %s', async (mode) => {
    const { service, jwt, personIdentity } = makeService();
    if (mode === 'unavailable') personIdentity.findPersonId.mockRejectedValue(new Error('Oracle unavailable'));
    else personIdentity.findPersonId.mockResolvedValue(mode === 'missing' ? undefined : 'invalid');
    const login = await service.login(LOGIN);
    expect(login.status).toBe('success');
    for (const token of [login.token!, login.refreshtoken!]) {
      expect(jwt.verify(token)).not.toHaveProperty('person_id');
    }
    const refreshed = await service.refresh({ refreshtoken: login.refreshtoken! });
    expect(jwt.verify(refreshed.token!)).not.toHaveProperty('person_id');
  });
});

describe('AuthService refresh + logout', () => {
  it('login issues an access + refresh pair with jti/typ claims', async () => {
    const { service, jwt } = makeService();
    const res = await service.login(LOGIN);

    expect(res.status).toBe('success');
    const access = jwt.decode<Record<string, unknown>>(res.token!);
    const refresh = jwt.decode<Record<string, unknown>>(res.refreshtoken!);
    expect(access.jti).toBeDefined();
    expect(access.typ).toBeUndefined();
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

  it('logout succeeds even without claims or refresh token', async () => {
    const { service } = makeService();
    const user = { username: 'hmc1', roles: [Role.EMPLOYEE] } as AuthenticatedUser;
    await expect(service.logout(user, {})).resolves.toMatchObject({ status: 'success' });
  });
});
