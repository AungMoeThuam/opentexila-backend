import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { User, type UserEntity, type UserRole } from '../database/entities';
import { ApiException } from '../common/api-exception';
import { devAuthEnabled, type DevSession } from './dev-auth';

export const DEV_COOKIE_NAME = 'ot_dev_session';
const LIFETIME_MS = 8 * 60 * 60 * 1000;
const accounts: Readonly<Record<UserRole, string>> = {
  student: 'student.one@example.com',
  teacher: 'lecturer.one@example.com',
  admin: 'admin.demo@example.com',
};

export type DevProfile = Pick<
  UserEntity,
  'id' | 'name' | 'email' | 'role' | 'status' | 'must_change_password'
>;
const profile = (user: UserEntity): DevProfile => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  status: user.status,
  must_change_password: user.must_change_password,
});

@Injectable()
export class DevAuthService {
  private readonly sessions = new Map<string, DevSession>();
  private readonly users: Repository<UserEntity>;

  constructor(@Inject(DATABASE) database: DataSource) {
    if (!devAuthEnabled())
      throw new Error('Development authentication is disabled.');
    this.users = database.getRepository(User);
  }

  read(cookie: string | undefined): { id?: string; session?: DevSession } {
    for (const [id, session] of this.sessions) {
      if (+session.cookie.expires <= Date.now()) this.sessions.delete(id);
    }
    const id = cookie
      ?.split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${DEV_COOKIE_NAME}=`))
      ?.slice(DEV_COOKIE_NAME.length + 1);
    return { id, session: id ? this.sessions.get(id) : undefined };
  }

  rotate(
    previousId: string | undefined,
    user?: UserEntity,
  ): { session: DevSession; cookie: string } {
    this.destroy(previousId);
    if (this.sessions.size >= 1000)
      throw new ApiException(
        503,
        'DEV_SESSION_LIMIT',
        'Too many development sessions. Restart the API.',
      );
    const id = randomBytes(32).toString('hex');
    const session: DevSession = {
      csrfToken: randomBytes(32).toString('hex'),
      cookie: { expires: new Date(Date.now() + LIFETIME_MS) },
      ...(user
        ? { userId: user.id, sessionVersion: user.session_version }
        : {}),
    };
    this.sessions.set(id, session);
    return {
      session,
      cookie: `${DEV_COOKIE_NAME}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${LIFETIME_MS / 1000}`,
    };
  }

  destroy(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }

  async me(session: DevSession | undefined): Promise<DevProfile> {
    if (!session?.userId)
      throw new ApiException(
        401,
        'UNAUTHENTICATED',
        'Select a development role to sign in.',
      );
    const user = await this.users.findOneBy({ id: session.userId });
    if (
      !user ||
      user.session_version !== session.sessionVersion ||
      user.status !== 'active'
    ) {
      throw new ApiException(
        401,
        'UNAUTHENTICATED',
        'This development session is no longer valid.',
      );
    }
    return profile(user);
  }

  async selectRole(role: UserRole, previousId: string | undefined) {
    const user = await this.users.findOneBy({ email: accounts[role] });
    if (!user)
      throw new ApiException(
        409,
        'DEV_ACCOUNT_MISSING',
        'Demo account is missing. Run npm run db:seed in the backend first.',
      );
    if (
      user.role !== role ||
      user.status !== 'active' ||
      user.must_change_password
    ) {
      throw new ApiException(
        403,
        'DEV_ACCOUNT_UNAVAILABLE',
        'The demo account must have the expected role, be active, and have no required password change.',
      );
    }
    return { ...this.rotate(previousId, user), profile: profile(user) };
  }
}
