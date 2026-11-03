import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import * as argon2 from 'argon2';
import type { DataSource, EntityManager } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { RefreshSession, User } from '../database/entities';
import { ApiException } from '../common/api-exception';
import type {
  AccessTokenClaims,
  AuthProfile,
  ChangePasswordDto,
  LoginDto,
  TokenResponse,
} from './dto/auth.dto';

const REFRESH_LIFETIME = 7 * 24 * 60 * 60 * 1000;
export const tokenHash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');
const unauthenticated = () =>
  new ApiException(401, 'UNAUTHENTICATED', 'A valid sign-in is required.');
const credentialsError = () =>
  new ApiException(
    401,
    'INVALID_CREDENTIALS',
    'The email or password is incorrect.',
  );
const profile = (user: User): AuthProfile => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  must_change_password: user.must_change_password,
});

export interface AuthIdentity {
  user: User;
  session: RefreshSession;
}
export interface IssuedTokens {
  response: TokenResponse;
  refreshToken: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;

  constructor(
    @Inject(DATABASE) private readonly database: DataSource,
    private readonly jwt: JwtService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash(randomBytes(32), {
      type: argon2.argon2id,
    });
  }

  private async userForUpdate(
    manager: EntityManager,
    id: number,
  ): Promise<User | null> {
    return manager
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('u.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }

  private async issue(
    user: User,
    session: RefreshSession,
    refreshToken: string,
  ): Promise<IssuedTokens> {
    const claims: AccessTokenClaims = {
      sub: String(user.id),
      sid: session.id,
      sessionVersion: user.session_version,
    };
    return {
      response: {
        accessToken: await this.jwt.signAsync(claims),
        tokenType: 'Bearer',
        expiresIn: 900,
        user: profile(user),
      },
      refreshToken,
      expiresAt: session.expires_at,
    };
  }

  async login(input: LoginDto): Promise<IssuedTokens> {
    const user = await this.database
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('u.email = :email', { email: input.email.trim().toLowerCase() })
      .getOne();
    const valid = await argon2.verify(
      user?.password_hash ?? this.dummyHash,
      input.password,
    );
    if (!user || !valid || user.status !== 'active') throw credentialsError();
    return this.database.transaction(async (manager) => {
      const current = await this.userForUpdate(manager, user.id);
      if (
        !current ||
        current.status !== 'active' ||
        current.password_hash !== user.password_hash
      )
        throw credentialsError();
      const id = randomUUID();
      const session = manager.create(RefreshSession, {
        id,
        user_id: user.id,
        token_hash: '',
        expires_at: new Date(Date.now() + REFRESH_LIFETIME),
        revoked_at: null,
      });
      const refreshToken = await this.signRefresh(current, session);
      session.token_hash = tokenHash(refreshToken);
      await manager.save(session);
      return this.issue(current, session, refreshToken);
    });
  }

  private validateClaims(claims: AccessTokenClaims): void {
    const id = Number(claims.sub);
    if (
      typeof claims.sub !== 'string' ||
      !/^[1-9]\d*$/.test(claims.sub) ||
      !Number.isSafeInteger(id) ||
      id > 4294967295 ||
      typeof claims.sid !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        claims.sid,
      ) ||
      !Number.isSafeInteger(claims.sessionVersion) ||
      claims.sessionVersion < 0 ||
      claims.sessionVersion > 4294967295
    )
      throw unauthenticated();
  }

  private async signRefresh(
    user: User,
    session: RefreshSession,
  ): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: String(user.id),
        sid: session.id,
        sessionVersion: user.session_version,
        nonce: randomBytes(32).toString('hex'),
      },
      {
        audience: 'opentexila-refresh',
        expiresIn: Math.max(
          1,
          Math.ceil((+session.expires_at - Date.now()) / 1000),
        ),
      },
    );
  }

  private async refreshClaims(
    token: string | undefined,
  ): Promise<AccessTokenClaims> {
    if (!token) throw unauthenticated();
    try {
      const claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        audience: 'opentexila-refresh',
      });
      this.validateClaims(claims);
      return claims;
    } catch {
      throw unauthenticated();
    }
  }

  async refresh(token: string | undefined): Promise<IssuedTokens> {
    const claims = await this.refreshClaims(token);
    const id = claims.sid;
    const existing = await this.database
      .getRepository(RefreshSession)
      .findOneBy({ id, user_id: Number(claims.sub) });
    if (!existing) throw unauthenticated();
    const result = await this.database.transaction(async (manager) => {
      // All auth mutations lock user before session, including password revocation.
      const user = await this.userForUpdate(manager, existing.user_id);
      const session = await manager
        .getRepository(RefreshSession)
        .createQueryBuilder('s')
        .addSelect('s.token_hash')
        .where('s.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();
      if (
        !user ||
        user.status !== 'active' ||
        !session ||
        session.revoked_at ||
        +session.expires_at <= Date.now()
      )
        return null;
      if (claims.sessionVersion !== user.session_version) return null;
      if (
        !timingSafeEqual(
          Buffer.from(session.token_hash),
          Buffer.from(tokenHash(token!)),
        )
      ) {
        // Commit replay revocation before rejecting the request outside the transaction.
        session.revoked_at = new Date();
        await manager.save(session);
        return null;
      }
      const next = await this.signRefresh(user, session);
      session.token_hash = tokenHash(next);
      await manager.save(session);
      return this.issue(user, session, next);
    });
    if (!result) throw unauthenticated();
    return result;
  }

  async authenticate(authorization: string | undefined): Promise<AuthIdentity> {
    if (!authorization || !/^Bearer [^\s]+$/i.test(authorization))
      throw unauthenticated();
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(
        authorization.slice(7),
      );
    } catch {
      throw unauthenticated();
    }
    this.validateClaims(claims);
    const id = Number(claims.sub);
    const session = await this.database
      .getRepository(RefreshSession)
      .findOneBy({ id: claims.sid, user_id: id });
    const user = await this.database.getRepository(User).findOneBy({ id });
    if (
      !session ||
      session.revoked_at ||
      +session.expires_at <= Date.now() ||
      !user ||
      user.status !== 'active' ||
      user.session_version !== claims.sessionVersion
    )
      throw unauthenticated();
    return { user, session };
  }

  async me(authorization: string | undefined): Promise<AuthProfile> {
    return profile((await this.authenticate(authorization)).user);
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const claims = await this.refreshClaims(token);
    const id = claims.sid;
    const existing = await this.database
      .getRepository(RefreshSession)
      .findOneBy({ id, user_id: Number(claims.sub) });
    if (!existing) return;
    await this.database.transaction(async (manager) => {
      await this.userForUpdate(manager, existing.user_id);
      // Only a signed refresh credential may revoke this session, including a stale one.
      await manager.update(RefreshSession, { id }, { revoked_at: new Date() });
    });
  }

  async changePassword(
    authorization: string | undefined,
    input: ChangePasswordDto,
  ): Promise<void> {
    const identity = await this.authenticate(authorization);
    const user = await this.database
      .getRepository(User)
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('u.id = :id', { id: identity.user.id })
      .getOne();
    if (
      !user ||
      !(await argon2.verify(user.password_hash, input.currentPassword))
    )
      throw credentialsError();
    if (input.currentPassword === input.newPassword)
      throw new ApiException(
        422,
        'VALIDATION_ERROR',
        'Choose a different password.',
      );
    const hash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
    });
    await this.database.transaction(async (manager) => {
      const current = await this.userForUpdate(manager, user.id);
      const session = await manager.findOneBy(RefreshSession, {
        id: identity.session.id,
      });
      if (
        !current ||
        current.status !== 'active' ||
        current.password_hash !== user.password_hash ||
        current.session_version !== identity.user.session_version ||
        !session ||
        session.revoked_at ||
        +session.expires_at <= Date.now()
      )
        throw unauthenticated();
      await manager.update(
        User,
        { id: user.id },
        {
          password_hash: hash,
          must_change_password: false,
          session_version: current.session_version + 1,
        },
      );
      await manager.update(
        RefreshSession,
        { user_id: user.id },
        { revoked_at: new Date() },
      );
    });
  }
}
