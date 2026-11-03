import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { UserRole } from '../../database/entities';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(1024)
  newPassword!: string;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  sessionVersion: number;
}

export interface AuthProfile {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  must_change_password: boolean;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AuthProfile;
}
