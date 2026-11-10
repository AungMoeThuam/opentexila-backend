import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsString, Length, MaxLength } from 'class-validator';
import { QueryInteger } from '../../common/dto/query-integer.decorator';

// Roles an admin may create. Admin accounts are never created through the API.
export const CREATABLE_ROLES = ['student', 'lecturer'] as const;
export type CreatableRole = (typeof CREATABLE_ROLES)[number];

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Passwords are never trimmed or logged; only the length is checked.
function TemporaryPassword(): PropertyDecorator {
  const message = 'temporary_password must be 12 to 1024 characters.';
  return applyDecorators(IsString({ message }), Length(12, 1024, { message }));
}

export class CreateUserDto {
  @Transform(trimmed)
  @IsString({ message: 'name must be 1 to 100 characters.' })
  @Length(1, 100, { message: 'name must be 1 to 100 characters.' })
  name!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address.' })
  @MaxLength(254, { message: 'email must be at most 254 characters.' })
  email!: string;

  @IsIn(CREATABLE_ROLES, { message: 'role must be student or lecturer.' })
  role!: CreatableRole;

  @TemporaryPassword()
  temporary_password!: string;
}

export class ResetPasswordDto {
  @TemporaryPassword()
  temporary_password!: string;
}

export class UserParamsDto {
  @QueryInteger(4294967295)
  userId!: number;
}
