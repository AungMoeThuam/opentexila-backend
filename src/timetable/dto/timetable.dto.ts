import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// Dates used to filter the timetable: YYYY-MM-DD.
// Actual calendar validity and range ordering are
// checked in the service.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Require UTC timestamps for batch rescheduling.
// Example: 2026-11-18T09:00:00.000Z
const UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * Query parameters for retrieving timetable sessions.
 *
 * Example:
 * GET /api/v1/class-sessions
 *   ?from=2026-11-16
 *   &to=2026-11-22
 *   &page=1
 *   &limit=20
 */
export class TimetableQueryDto {
  @IsString()
  @IsNotEmpty()
  @Matches(DATE_PATTERN, {
    message: 'from must use YYYY-MM-DD format.',
  })
  from!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(DATE_PATTERN, {
    message: 'to must use YYYY-MM-DD format.',
  })
  to!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * Represents one existing session to be rescheduled.
 *
 * All timestamps must be UTC ISO 8601 strings.
 */
export class TimetableSessionChangeDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4294967295)
  id!: number;

  @IsString()
  @Matches(UTC_TIMESTAMP_PATTERN, {
    message: 'starts_at must be a UTC ISO timestamp.',
  })
  starts_at!: string;

  @IsString()
  @Matches(UTC_TIMESTAMP_PATTERN, {
    message: 'late_after must be a UTC ISO timestamp.',
  })
  late_after!: string;

  @IsString()
  @Matches(UTC_TIMESTAMP_PATTERN, {
    message: 'ends_at must be a UTC ISO timestamp.',
  })
  ends_at!: string;
}

/**
 * Batch rescheduling request.
 *
 * Example:
 * PATCH /api/v1/class-sessions/batch
 *
 * {
 *   "changes": [
 *     {
 *       "id": 1,
 *       "starts_at": "2026-11-18T09:00:00.000Z",
 *       "late_after": "2026-11-18T09:15:00.000Z",
 *       "ends_at": "2026-11-18T11:00:00.000Z"
 *     }
 *   ]
 * }
 */
export class TimetableBatchUpdateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TimetableSessionChangeDto)
  changes!: TimetableSessionChangeDto[];
}
