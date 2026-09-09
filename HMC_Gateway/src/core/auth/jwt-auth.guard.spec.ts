import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard, IAuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthenticatedUser, DEV_USER, Role } from './auth-user.interface';

describe('JwtAuthGuard', () => {
  const makeContext = (req: Record<string, unknown> = {}): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;

  const makeGuard = (isPublic = false, authDisabled = false): IAuthGuard =>
    new JwtAuthGuard(
      { getAllAndOverride: () => isPublic } as unknown as Reflector,
      { get: () => authDisabled } as unknown as ConfigService,
    );

  const makeUser = (
    claims: Record<string, unknown> = { username: 'AIBRAHIM39', employeeNumber: '037400' },
  ): AuthenticatedUser => ({
    username: 'AIBRAHIM39',
    employeeNumber: '037400',
    roles: [Role.EMPLOYEE],
    claims,
  });

  it('allows @Public() routes without invoking passport', () => {
    expect(makeGuard(true).canActivate(makeContext())).toBe(true);
  });

  it('injects DEV_USER and allows the request when AUTH_DISABLED=true', () => {
    const req: { user?: unknown } = {};

    expect(makeGuard(false, true).canActivate(makeContext(req))).toBe(true);
    expect(req.user).toEqual(DEV_USER);
  });

  it('handleRequest returns the user when present', () => {
    const user = makeUser();

    expect(makeGuard().handleRequest(null, user, undefined, makeContext())).toBe(user);
  });

  it('handleRequest throws UnauthorizedException when there is no user', () => {
    expect(() => makeGuard().handleRequest(null, null, undefined, makeContext())).toThrow(
      UnauthorizedException,
    );
  });

  it('handleRequest rethrows a passport error', () => {
    const err = new Error('token expired');

    expect(() => makeGuard().handleRequest(err, null, undefined, makeContext())).toThrow(
      'token expired',
    );
  });

  it.each([
    '',
    '?other=value',
    '?username=AIBRAHIM39',
    '?enum=037400',
    '?username=AIBRAHIM39&enum=037400',
    '?user%6Eame=%41IBRAHIM39&enum=%3037400',
  ])('allows matching or absent identity query parameters: %s', (query) => {
    const user = makeUser();
    const context = makeContext({ originalUrl: `/api/v1/employee/profile${query}` });

    expect(makeGuard().handleRequest(null, user, undefined, context)).toBe(user);
  });

  it.each([
    ['?username=aibrahim39', { username: 'AIBRAHIM39' }],
    ['?username=AIBRAHIM39', { username: 'aibrahim39' }],
    ['?enum=emp0037', { employeeNumber: 'EMP0037' }],
    ['?enum=EMP0037', { employeeNumber: 'emp0037' }],
    ['?username=AiBrAhIm39&enum=Emp0037', { username: 'aibrahim39', employeeNumber: 'EMP0037' }],
  ])('matches either or both supplied values case-insensitively: %s', (query, claims) => {
    const user = makeUser(claims);
    const context = makeContext({ originalUrl: `/api/v1/employee/profile${query}` });

    expect(makeGuard().handleRequest(null, user, undefined, context)).toBe(user);
  });

  it.each([
    '?username=OTHER',
    '?enum=999999',
    '?enum=37400',
    '?username=aibrahim39&enum=999999',
    '?username=OTHER&enum=037400',
    '?username=',
    '?enum',
    '?username=%20AIBRAHIM39',
    '?enum=037400%20',
    '?username=AIBRAHIM39&username=OTHER',
    '?enum=037400&enum=037400',
    '?username[]=AIBRAHIM39',
    '?enum[value]=037400',
    '?username=AIBRAHIM39&username%5B%5D=OTHER',
  ])('rejects mismatched or ambiguous identity query parameters: %s', (query) => {
    const context = makeContext({ originalUrl: `/api/v1/employee/profile${query}` });

    expect(() => makeGuard().handleRequest(null, makeUser(), undefined, context)).toThrow(
      'Unauthorized action',
    );
  });

  it.each([
    ['?username=AIBRAHIM39', { sub: 'AIBRAHIM39' }],
    ['?enum=037400', { sub: '037400', enum: '037400' }],
    ['?username=AIBRAHIM39', { username: ['AIBRAHIM39'] }],
    ['?enum=037400', { employeeNumber: 37400 }],
    ['?username=', { username: '' }],
  ])('requires the actual non-empty string JWT claim for %s', (query, claims) => {
    const context = makeContext({ originalUrl: `/api/v1/employee/profile${query}` });

    expect(() => makeGuard().handleRequest(null, makeUser(claims), undefined, context)).toThrow(
      'Unauthorized action',
    );
  });

  it('does not trust mapped user properties when original JWT claims are unavailable', () => {
    const user = { ...makeUser(), claims: undefined };
    const context = makeContext({ originalUrl: '/api/v1/employee/profile?enum=037400' });

    expect(() => makeGuard().handleRequest(null, user, undefined, context)).toThrow(
      UnauthorizedException,
    );
  });

  it.each([
    ['', {}, 'Unauthorized action'],
    ['&lang=ar', {}, 'إجراء غير مصرح به'],
    ['', { lang: 'ar' }, 'إجراء غير مصرح به'],
    ['&lang=en', { lang: 'ar' }, 'Unauthorized action'],
    ['&lang=ar', { lang: 'en' }, 'إجراء غير مصرح به'],
    ['&lang=fr', { lang: 'ar' }, 'Unauthorized action'],
    ['', { lang: ['ar'] }, 'إجراء غير مصرح به'],
  ])('localizes a mismatch for query %s and headers %j', (query, headers, message) => {
    const context = makeContext({
      originalUrl: `/api/v1/employee/profile?username=OTHER${query}`,
      headers,
    });

    expect(() => makeGuard().handleRequest(null, makeUser(), undefined, context)).toThrow(message);
  });

  it('uses the localized action error when a scoped request has no authenticated user', () => {
    const context = makeContext({ originalUrl: '/api/v1/employee/profile?enum=037400&lang=ar' });

    expect(() => makeGuard().handleRequest(null, null, undefined, context)).toThrow(
      'إجراء غير مصرح به',
    );
  });

  it.each([
    [true, false, '?username=AIBRAHIM39'],
    [false, true, '?enum=037400'],
    [true, true, '?username[]=AIBRAHIM39'],
  ])(
    'requires passport for scoped requests even with public=%s and bypass=%s',
    async (isPublic, authDisabled, query) => {
      const passport = jest
        .spyOn(AuthGuard('jwt').prototype, 'canActivate')
        .mockResolvedValue(true);
      const context = makeContext({ originalUrl: `/api/v1/auth/login${query}` });

      try {
        await expect(makeGuard(isPublic, authDisabled).canActivate(context)).resolves.toBe(true);
        expect(passport).toHaveBeenCalledWith(context);
      } finally {
        passport.mockRestore();
      }
    },
  );

  it('checks identity parameters beyond the Express query parser limit', () => {
    const padding = new URLSearchParams(Array.from({ length: 1001 }, (_, i) => [`p${i}`, 'x']));
    const context = makeContext({
      originalUrl: `/api/v1/employee/profile?${padding}&username=OTHER`,
      query: { p0: 'x' },
    });

    expect(() => makeGuard().handleRequest(null, makeUser(), undefined, context)).toThrow(
      UnauthorizedException,
    );
  });
});
