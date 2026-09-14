import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './decorators/roles.decorator';
import { AuthenticatedUser, Role } from './auth-user.interface';
import { ERROR_MESSAGES } from '@shared/constants/error-codes';

/** Enforces @Roles(...) on approver/supervisor operations (20-23, 68-71, 35-36). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = req.user;
    const allowed = !!user && required.some((role) => user.roles?.includes(role));
    if (!allowed) throw new ForbiddenException(ERROR_MESSAGES.FORBIDDEN);
    return true;
  }
}
