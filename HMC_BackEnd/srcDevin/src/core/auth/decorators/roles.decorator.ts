import { SetMetadata } from '@nestjs/common';
import { Role } from '../auth-user.interface';

export const ROLES_KEY = 'roles';

/** Require one of the given roles (checked by RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
