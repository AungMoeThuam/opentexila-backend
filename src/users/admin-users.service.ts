import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { IsNull, type DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { RefreshSession, User, type UserRole } from '../database/entities';
import { ApiException, notFound } from '../common/api-exception';
import { pageMeta } from '../common/query-reader';
import { duplicateKey } from '../courses/class-management.rules';
import { likePattern } from '../courses/courses.service';
import type {
  CreateUserDto,
  ListUsersQueryDto,
  ResetPasswordDto,
} from './dto/admin-user.dto';

export interface AdminUserDto {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  must_change_password: boolean;
  is_active: boolean;
}

const emailTaken = (): ApiException =>
  new ApiException(
    409,
    'EMAIL_ALREADY_EXISTS',
    'An account with this email already exists.',
    { email: 'An account with this email already exists.' },
  );

const adminTarget = (): ApiException =>
  new ApiException(
    403,
    'FORBIDDEN',
    'Admin account passwords cannot be reset here.',
  );

// Only safe profile fields leave the service; the hash never does.
const toAdminUser = (user: User): AdminUserDto => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  must_change_password: user.must_change_password,
  is_active: user.status === 'active',
});

const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id });

@Injectable()
export class AdminUsersService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  // Search is a literal, case-insensitive substring of the name or email.
  async listUsers(query: ListUsersQueryDto) {
    const builder = this.database
      .getRepository(User)
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.name',
        'user.email',
        'user.role',
        'user.status',
        'user.must_change_password',
      ]);
    if (query.role !== undefined)
      builder.andWhere('user.role = :role', { role: query.role });
    if (query.search !== undefined)
      builder.andWhere(
        '(user.name LIKE :pattern OR user.email LIKE :pattern)',
        { pattern: likePattern(query.search) },
      );
    const [users, total] = await builder
      .orderBy('user.name', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      data: users.map(toAdminUser),
      meta: pageMeta(query.page, query.limit, total),
    };
  }

  async createUser(body: CreateUserDto): Promise<{ data: AdminUserDto }> {
    const values = {
      name: body.name,
      email: body.email,
      role: body.role,
      status: 'active' as const,
      must_change_password: true,
      password_hash: await hashPassword(body.temporary_password),
    };
    let id: number;
    try {
      const result = await this.database.getRepository(User).insert(values);
      id = Number(result.identifiers[0]?.id);
    } catch (error) {
      if (duplicateKey(error) !== undefined) throw emailTaken();
      throw error;
    }
    return { data: toAdminUser({ ...values, id } as User) };
  }

  // The user row is locked before the sessions, like every other auth change.
  async resetPassword(userId: number, body: ResetPasswordDto): Promise<void> {
    const password_hash = await hashPassword(body.temporary_password);
    await this.database.transaction(async (manager) => {
      const user = await manager
        .getRepository(User)
        .createQueryBuilder('u')
        .where('u.id = :id', { id: userId })
        .setLock('pessimistic_write')
        .getOne();
      if (!user) throw notFound('User not found.');
      if (user.role === 'admin') throw adminTarget();
      await manager.update(
        User,
        { id: userId },
        {
          password_hash,
          must_change_password: true,
          session_version: user.session_version + 1,
        },
      );
      await manager.update(
        RefreshSession,
        { user_id: userId, revoked_at: IsNull() },
        { revoked_at: new Date() },
      );
    });
  }
}
