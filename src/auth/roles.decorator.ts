import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../database/entities';

export const AUTH_ROLES = 'auth:roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(AUTH_ROLES, roles);
