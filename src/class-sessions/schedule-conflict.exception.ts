import { ApiException, type ErrorEnvelope } from '../common/api-exception';
import type { TimetableConflictType } from '../timetable/timetable-conflicts';

// One session that clashes with the session being scheduled, and why.
export interface ScheduleConflictDto {
  types: TimetableConflictType[];
  session: {
    id: number;
    class: {
      id: number;
      course: { code: string; name: string };
      section: string;
      term: string;
    };
    lecturer: { id: number; name: string };
    room_label: string;
    starts_at: string;
    ends_at: string;
  };
}

type ConflictEnvelope = ErrorEnvelope & {
  error: ErrorEnvelope['error'] & { conflicts: ScheduleConflictDto[] };
};

// 409 SCHEDULE_CONFLICT with the clashing sessions listed in `error.conflicts`,
// so a person can see what to move. The usual error fields are unchanged.
export class ScheduleConflictException extends ApiException {
  private readonly conflicts: ScheduleConflictDto[];

  constructor(message: string, conflicts: ScheduleConflictDto[]) {
    super(409, 'SCHEDULE_CONFLICT', message);
    this.conflicts = conflicts;
  }

  override getResponse(): ConflictEnvelope {
    const base = super.getResponse();
    return { error: { ...base.error, conflicts: this.conflicts } };
  }
}
