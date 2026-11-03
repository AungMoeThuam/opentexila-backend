import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response, CookieOptions } from 'express';
import { ApiException } from '../common/api-exception';
import { tokenHash, type IssuedTokens } from './auth.service';

@Injectable()
export class AuthCookies {
  constructor(private readonly jwt: JwtService) {}

  private name(kind: 'refresh' | 'csrf'): string {
    return `${process.env.NODE_ENV === 'production' ? '__Host-' : ''}ot_${kind}`;
  }
  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    };
  }
  private read(request: Request, kind: 'refresh' | 'csrf'): string | undefined {
    const prefix = `${this.name(kind)}=`;
    const cookies =
      request.headers.cookie
        ?.split(';')
        .map((c) => c.trim())
        .filter((c) => c.startsWith(prefix)) ?? [];
    return cookies.length === 1 ? cookies[0]!.slice(prefix.length) : undefined;
  }
  refresh(request: Request): string | undefined {
    return this.read(request, 'refresh');
  }

  async csrf(
    request: Request,
    response: Response,
    refresh = this.refresh(request),
  ): Promise<string> {
    const token = await this.jwt.signAsync(
      {
        purpose: 'csrf',
        binding: tokenHash(refresh ?? ''),
        nonce: randomBytes(16).toString('hex'),
      },
      { audience: 'opentexila-csrf', expiresIn: 3600 },
    );
    response.cookie(this.name('csrf'), token, {
      ...this.options(),
      maxAge: 3600000,
    });
    return token;
  }

  async checkCsrf(request: Request): Promise<void> {
    const cookie = this.read(request, 'csrf');
    const header = request.headers['x-csrf-token'];
    const invalid = () =>
      new ApiException(
        403,
        'CSRF_INVALID',
        'The security token is missing or invalid.',
      );
    if (
      !cookie ||
      typeof header !== 'string' ||
      Buffer.byteLength(cookie) !== Buffer.byteLength(header) ||
      !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
    )
      throw invalid();
    try {
      const claims = await this.jwt.verifyAsync<{
        purpose: string;
        binding: string;
      }>(header, { audience: 'opentexila-csrf' });
      if (
        claims.purpose !== 'csrf' ||
        claims.binding !== tokenHash(this.refresh(request) ?? '')
      )
        throw invalid();
    } catch {
      throw invalid();
    }
  }

  async issue(request: Request, response: Response, issued: IssuedTokens) {
    response.cookie(this.name('refresh'), issued.refreshToken, {
      ...this.options(),
      maxAge: Math.max(0, +issued.expiresAt - Date.now()),
    });
    const csrfToken = await this.csrf(request, response, issued.refreshToken);
    return { data: { ...issued.response, csrfToken } };
  }

  clear(response: Response): void {
    for (const kind of ['refresh', 'csrf'] as const)
      response.clearCookie(this.name(kind), this.options());
  }
}
