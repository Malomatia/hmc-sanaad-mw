import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opt a route out of the global JwtAuthGuard (e.g. op-1 login, /health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
