import type {
  AttendanceStatus,
  ClassSessionState,
} from '../../database/entities';
import type { PageMeta } from '../../common/query-reader';
import type { ClassSummaryDto } from '../class-summary';
import type { SessionAvailability } from '../attendance.rules';

export interface DataResponse<T> {
  data: T;
}
export interface PaginatedResponse<T> extends DataResponse<T[]> {
  meta: PageMeta;
}

export interface AttendanceRecordDto {
  class_session_id: number;
  student_id: number;
  status: AttendanceStatus;
  checked_in_at: string | null;
  distance_m: string | null;
}

export type CheckInBlockReason =
  | 'CLASS_CANCELLED'
  | 'ROLE_NOT_STUDENT'
  | 'NOT_ELIGIBLE'
  | 'ALREADY_CHECKED_IN'
  | 'NOT_STARTED'
  | 'CLASS_ENDED';
export type CheckInEligibility =
  | { allowed: true; reason: null }
  | { allowed: false; reason: CheckInBlockReason };

export interface ClassSessionDto {
  id: number;
  class_id: number;
  class: ClassSummaryDto;
  starts_at: string;
  late_after: string;
  ends_at: string;
  state: ClassSessionState;
  availability: SessionAvailability;
  my_attendance: AttendanceRecordDto | null;
}

export interface ClassSessionDetailDto extends ClassSessionDto {
  check_in: CheckInEligibility;
}

export interface CheckInResponseDto {
  class_session_id: number;
  attendance_record: AttendanceRecordDto;
}

export interface PersonalAttendanceRecordDto {
  class_session_id: number;
  student_id: number;
  class: ClassSummaryDto;
  starts_at: string;
  ends_at: string;
  class_state: ClassSessionState;
  status: AttendanceStatus;
  checked_in_at: string | null;
}

export interface RosterRecordDto {
  class_session_id: number;
  student_id: number;
  status: AttendanceStatus;
  checked_in_at: string | null;
  student: { id: number; name: string };
}

export interface SessionRosterResponseDto extends PaginatedResponse<RosterRecordDto> {
  context: {
    class_session_id: number;
    class: ClassSummaryDto;
    starts_at: string;
    late_after: string;
    ends_at: string;
    class_state: ClassSessionState;
  };
}
