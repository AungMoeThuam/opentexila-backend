import { IsIn, IsString, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { QueryInteger } from '../../common/dto/query-integer.decorator';

export const MANAGED_SESSION_STATES = ['scheduled', 'cancelled'] as const;
export type ManagedSessionState = (typeof MANAGED_SESSION_STATES)[number];

export class ManagedClassParamsDto {
  @QueryInteger(4294967295)
  classId!: number;
}

// Filters for GET /classes/:classId/class-sessions. Paging comes from the base class.
export class ListManagedSessionsQueryDto extends PaginationQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(MANAGED_SESSION_STATES, {
    message: 'state must be scheduled or cancelled.',
  })
  state?: ManagedSessionState;
}

const TIME_MESSAGE = 'must be a UTC time such as 2026-11-20T01:00:00.000Z.';

// Body of POST /classes/:classId/class-sessions. The venue and the state come
// from the class and the server, so they are not fields here. The times are
// checked in the service, which reports every wrong field at once.
export class CreateClassSessionDto {
  @IsString({ message: `starts_at ${TIME_MESSAGE}` })
  starts_at!: string;

  @IsString({ message: `late_after ${TIME_MESSAGE}` })
  late_after!: string;

  @IsString({ message: `ends_at ${TIME_MESSAGE}` })
  ends_at!: string;
}
