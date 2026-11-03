import type { Request } from 'express';
import type { UserRole } from '../database/entities';

// Only server-verified identity is exposed to feature controllers.
export interface AuthenticatedUser {
  id: number;
  role: UserRole;
}

export type AuthenticatedRequest = Request & {
  authUser?: AuthenticatedUser;
};
