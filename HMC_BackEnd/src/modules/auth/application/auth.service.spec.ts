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

function makeService(overrides: Partial<typeof AUTH_CFG> = {}) {
  const authCfg = { ...AUTH_CFG, ...overrides };
  const jwt = new JwtService({
    secret: authCfg.jwtSecret,
    signOptions: { expiresIn: authCfg.jwtExpiresIn as JwtSignOptions['expiresIn'] },
  });
  const mpinStore = { verify: jest.fn().mockResolvedValue(true) } as unknown as MpinStorePort;
  const ldap = {
    validate: jest.fn().mockResolvedValue({
      username: 'hmc1',
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
  const service = new AuthService(
    jwt,
    mpinStore,
    ldap,
    functionAccess,
    devices,
    audit,
    revocation,
    config,
  );
  return { service, jwt, revocation, devices };
}

const LOGIN = {
  username: 'hmc1',
  mpin: '123456',
  imeinumber: 'imei-1',
  platform: 'iOS',
  version: '1.0.0',
};

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
  });

  it('refresh exchanges a valid refresh token for a new pair and rotates it', async () => {
    const { service } = makeService();
    const login = await service.login(LOGIN);

    const refreshed = await service.refresh({ refreshtoken: login.refreshtoken! });
    expect(refreshed.status).toBe('success');
    expect(refreshed.token).toBeDefined();
    expect(refreshed.refreshtoken).toBeDefined();

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
