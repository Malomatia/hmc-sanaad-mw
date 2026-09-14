import { SetMetadata } from '@nestjs/common';

export const REQUIRE_FUNCTION_KEY = 'requireFunction';

/**
 * Require an enabled function/module code (from the login functionaccesslist)
 * to access a route. Enforced server-side by FunctionAccessGuard, so the backend
 * gates access regardless of the mobile UI. e.g. @RequireFunction('PYSRS').
 */
export const RequireFunction = (code: string) => SetMetadata(REQUIRE_FUNCTION_KEY, code);
