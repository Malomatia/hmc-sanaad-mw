import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_FUNCTION_KEY } from './decorators/require-function.decorator';
import { AuthenticatedUser } from './auth-user.interface';

/**
 * Enforces @RequireFunction('CODE') using the enabled function codes carried in
 * the JWT (login functionaccesslist). Routes without the decorator pass through.
 * Backend authorization is enforced here even though the mobile UI also hides
 * disabled modules (framework doc, API-5).
 */
@Injectable()
export class FunctionAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(REQUIRE_FUNCTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const functions = req.user?.functions ?? [];
    if (!functions.includes(required)) {
      throw new ForbiddenException(`Access to function "${required}" is not enabled for this user.`);
    }
    return true;
  }
}
