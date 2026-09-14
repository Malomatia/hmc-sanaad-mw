import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from './auth-user.interface';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard development audit context', () => {
  it('retains token claims so development API calls carry the same audit fields', () => {
    const claims = {
      username: 'hmc1',
      employeeNumber: '037400',
      deviceImei: 'imei-1',
      appName: 'Sanaad',
      appVersion: '1.0.0',
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const req: { headers: Record<string, string>; user?: AuthenticatedUser } = {
      headers: { authorization: `Bearer header.${payload}.signature` },
    };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const config = { get: jest.fn().mockReturnValue(true) } as unknown as ConfigService;
    const guard = new JwtAuthGuard(new Reflector(), config);

    expect(guard.canActivate(context)).toBe(true);
    expect(req.user).toMatchObject({ username: 'hmc1', claims });
  });
});
