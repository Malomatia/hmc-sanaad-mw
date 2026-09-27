import { ArgumentsHost, ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { envValidationSchema } from '../config/env.validation';
import { DevConsoleGuard } from '../dev-console/dev-console.guard';
import { DevConsoleService } from '../dev-console/dev-console.service';
import { OracleLogStore } from '../database/oracle-log.store';
import { OracleService } from '../database/oracle.service';
import { DiagnosticsEnabledGuard } from './diagnostics-enabled.guard';
import { AllExceptionsFilter } from './all-exceptions.filter';

const TOKEN = 'local-test-console-token-with-32-bytes';
const context = (headers: Record<string, string> = {}, query = {}) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', path: '/internal', headers, query }),
    }),
  }) as ExecutionContext;
const config = (nodeEnv = 'test', token = TOKEN, enabled = true) =>
  new ConfigService({
    app: { nodeEnv, apiPrefix: 'api/v1' },
    oracle: {},
    diagnostics: { enabled },
    devConsole: { enabled, token, allowWrite: false, maxRows: 100, timeoutMs: 1000 },
  });

describe.each([DevConsoleGuard, DiagnosticsEnabledGuard])('%s operational isolation', (Guard) => {
  it('refuses production even when the flag and token are configured', () => {
    expect(() =>
      new Guard(config('production')).canActivate(context({ 'x-console-token': TOKEN })),
    ).toThrow(expect.objectContaining({ status: 404 }));
  });
  it('requires a configured, non-empty strong console token', () => {
    expect(() => new Guard(config('test', '')).canActivate(context())).toThrow();
    expect(() => new Guard(config()).canActivate(context())).toThrow();
    expect(() =>
      new Guard(config()).canActivate(context({ 'x-console-token': 'wrong' })),
    ).toThrow();
  });
  it('does not accept credentials through a query string', () => {
    expect(() => new Guard(config()).canActivate(context({}, { token: TOKEN }))).toThrow();
  });
  it('allows explicitly enabled local access with the correct header only', () => {
    expect(new Guard(config()).canActivate(context({ 'x-console-token': TOKEN }))).toBe(true);
  });
  it('honors the disabled flag', () => {
    expect(() =>
      new Guard(config('test', TOKEN, false)).canActivate(context({ 'x-console-token': TOKEN })),
    ).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('Hardened configuration and throttling', () => {
  const production = {
    NODE_ENV: 'production',
    JWT_SECRET: 'test-production-shaped-secret-never-deployed',
  };

  it.each([
    { AUTH_DISABLED: true },
    { AUTH_STATIC_LOGIN: true },
    { OTP_IN_RESPONSE: true },
    { OTP_STATIC_VALUE: '123456' },
    { JWT_SECRET: 'dev-only-secret-change-me' },
    { JWT_SECRET: 'short' },
  ])('rejects unsafe production configuration %j', (overrides) => {
    expect(envValidationSchema.validate({ ...production, ...overrides }).error).toBeDefined();
  });
  it('accepts hardened production settings and defaults operational surfaces off', () => {
    const result = envValidationSchema.validate(production);
    expect(result.error).toBeUndefined();
    expect(result.value.DIAGNOSTICS_ENABLED).toBe(false);
    expect(result.value.DEV_CONSOLE_ENABLED).toBe(false);
  });
  it('does not let an operator switch override a server-side write prohibition', () => {
    const service = new DevConsoleService(config(), {} as OracleLogStore, {} as OracleService);
    expect(() => service.setWriteMode(true)).toThrow('disabled by server policy');
    expect(service.settings().allowWrite).toBe(false);
  });
  it('preserves a bounded Retry-After header with the normal error envelope', () => {
    const res = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ method: 'POST', url: '/auth/login' }),
        getResponse: () => res,
      }),
    };
    new AllExceptionsFilter().catch(
      new HttpException({ message: 'Limited', retryAfterSeconds: 60 }, 429),
      host as ArgumentsHost,
    );
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '60');
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        httpStatusCode: 429,
        message: 'Too many attempts. Please try again later.',
      }),
    );
  });
});
