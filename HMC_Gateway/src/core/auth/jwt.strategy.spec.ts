import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { Role } from './auth-user.interface';

const now = Math.floor(Date.now() / 1000);
const claims = { sub: '037400', username: 'TESTUSER', employeeNumber: '037400',
  deviceImei: 'device-1', sid: 'session-id', jti: 'access-id', typ: 'access', iat: now, exp: now + 3600 };

const makeStrategy = () => new JwtStrategy(new ConfigService({ auth: {
  jwtSecret: 'test-secret-at-least-thirty-two-bytes', jwtIssuer: 'sanaad', jwtAudience: 'sanaad-b2e', disabled: false,
} }));

describe('JwtStrategy', () => {
  it('maps a validated access payload', () => {
    const user = makeStrategy().validate({ ...claims, roles: [Role.SUPERVISOR], functions: ['LEAVE'],
      name: 'Test Employee', dept: 'IT', company: 'HMC' });
    expect(user).toMatchObject({ username: 'TESTUSER', employeeNumber: '037400', roles: [Role.SUPERVISOR],
      functions: ['LEAVE'], employeeName: 'Test Employee', department: 'IT', company: 'HMC' });
  });

  it.each(['sub', 'username', 'deviceImei', 'sid', 'jti', 'typ', 'iat', 'exp'])('requires %s', (key) => {
    expect(() => makeStrategy().validate({ ...claims, [key]: undefined })).toThrow('Invalid session token');
  });

  it.each([
    { typ: 'refresh' }, { typ: 'unknown' }, { exp: now - 1 }, { exp: '9999999999' },
    { iat: now + 3600 }, { roles: 'supervisor' }, { functions: [123] }, { username: '' },
  ])('rejects invalid claims %j', (invalid) => {
    expect(() => makeStrategy().validate({ ...claims, ...invalid } as never)).toThrow();
  });

  it('rejects sparse legacy payloads instead of inventing identity', () => {
    expect(() => makeStrategy().validate({ sub: '000001', enum: '000001' })).toThrow();
  });
});
