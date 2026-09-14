import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { AuthenticatedUser, Role } from './auth-user.interface';

/**
 * The approvals controller is role-gated at the CLASS level, and two of its
 * routes opt out with an empty `@Roles()` because they return only the caller's
 * own rows (ops 20 and 23). That opt-out is load-bearing: nothing in the system
 * assigns APPROVER/SUPERVISOR, so without it those routes answer 403 to every
 * user, including the person whose own data they list.
 *
 * It cannot be checked by running the app locally — AUTH_DISABLED injects a
 * DEV_USER holding every role, so every route passes — hence this test.
 */
describe('RolesGuard: handler overrides class', () => {
  const EMPLOYEE = { username: 'AIBRAHIM39', roles: [Role.EMPLOYEE] } as AuthenticatedUser;

  /** A context whose handler/class carry the given @Roles metadata. */
  function contextFor(handlerRoles: Role[] | undefined, classRoles: Role[] | undefined) {
    const handler = () => undefined;
    class Controller {}
    const reflector = new Reflector();
    if (handlerRoles) Reflect.defineMetadata('roles', handlerRoles, handler);
    if (classRoles) Reflect.defineMetadata('roles', classRoles, Controller);

    const ctx = {
      getHandler: () => handler,
      getClass: () => Controller,
      switchToHttp: () => ({ getRequest: () => ({ user: EMPLOYEE }) }),
    } as unknown as ExecutionContext;
    return { guard: new RolesGuard(reflector), ctx };
  }

  const CLASS_ROLES = [Role.APPROVER, Role.SUPERVISOR];

  it('blocks an employee on a route that inherits the class roles', () => {
    const { guard, ctx } = contextFor(undefined, CLASS_ROLES);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('lets the employee through when the handler declares no roles', () => {
    const { guard, ctx } = contextFor([], CLASS_ROLES);

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('still enforces a handler that names roles of its own', () => {
    const { guard, ctx } = contextFor([Role.APPROVER], undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
