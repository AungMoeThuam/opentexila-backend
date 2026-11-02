import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  ValidateIf,
  registerDecorator,
} from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { QueryInteger } from '../../common/dto/query-integer.decorator';
import { QueryReader } from '../../common/query-reader';
import { ApiException } from '../../common/api-exception';
import type { AttendanceStatus } from '../../database/entities';
import { timestamp } from '../attendance.rules';

export function TimestampInput(
  mode: 'history' | 'session' | 'utc',
): PropertyDecorator {
  return applyDecorators(
    Transform(({ value, key }: { value: unknown; key: string }) => {
      try {
        if (mode !== 'history') return timestamp(value, key, mode === 'utc');
        const reader = new QueryReader({ [key]: value });
        const date = reader.timestamp(key);
        reader.finish();
        return date;
      } catch (error: unknown) {
        if (!(error instanceof ApiException)) throw error;
        return value;
      }
    }),
    IsDate({ message: 'Must be a valid ISO 8601 timestamp with timezone.' }),
  );
}

function LaterThanFrom(): PropertyDecorator {
  return (target, propertyKey) =>
    registerDecorator({
      name: 'laterThanFrom',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: 'to must be later than from.' },
      validator: {
        validate(value: unknown, args) {
          const from: unknown =
            args && 'from' in args.object ? args.object.from : undefined;
          return (
            !(from instanceof Date && value instanceof Date) || from < value
          );
        },
      },
    });
}

export class ClassSessionsQueryDto extends PaginationQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @QueryInteger(4294967295)
  classId?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @TimestampInput('session')
  from?: Date;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @TimestampInput('session')
  @LaterThanFrom()
  to?: Date;
}

export class SessionRecordsQueryDto extends PaginationQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['pending', 'present', 'late', 'absent'], {
    message: 'status must be one of: pending, present, late, absent.',
  })
  status?: AttendanceStatus;
}

export class PersonalAttendanceQueryDto extends SessionRecordsQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @QueryInteger(4294967295)
  classId?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @TimestampInput('history')
  from?: Date;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @TimestampInput('history')
  @LaterThanFrom()
  to?: Date;

  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false || value === '' || value == null)
      return false;
    return value;
  })
  @IsBoolean({ message: 'includeCancelled must be either "true" or "false".' })
  includeCancelled: boolean = false;
}

export class ClassSessionParamsDto {
  @QueryInteger(4294967295)
  classSessionId!: number;
}
