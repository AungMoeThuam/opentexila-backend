import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../database/entities';

export const ATTENDANCE_ROLES = 'attendance:roles';
export const Roles = (...roles: UserRole[]) =>
  SetMetadata(ATTENDANCE_ROLES, roles);
