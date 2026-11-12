import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import type { FinaliseResultDto } from './dto/attendance-response.dto';
import { fail } from './attendance.rules';
import type { AttendanceCaller } from './attendance.rules';
import { databaseNow, lockClassSession } from './roster.service';

@Injectable()
export class FinalisationService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  // Lecturer finalises an ended Class session: every student still pending, and
  // every enrolled student without a record, becomes absent.
  async finaliseClassSession(
    user: AttendanceCaller,
    classSessionId: number,
  ): Promise<FinaliseResultDto> {
    return this.database.transaction(async (manager) => {
      const { session, classroom } = await lockClassSession(
        manager,
        classSessionId,
      );
      // Another lecturer's session looks the same as a missing session.
      if (classroom.lecturer_id !== user.id)
        fail(
          404,
          'RESOURCE_NOT_FOUND',
          'The requested resource was not found.',
        );
      const now = await databaseNow(manager); // Sampled after acquiring locks.
      const result = (
        outcome: FinaliseResultDto['outcome'],
        absent_marked = 0,
      ): FinaliseResultDto => ({
        class_session_id: session.id,
        outcome,
        absent_marked,
      });
      if (session.state === 'cancelled') return result('cancelled');
      if (now < session.ends_at) return result('not_due');
      const [conflicts] = await manager.query<{ total: number }[]>(
        `SELECT COUNT(*) AS total FROM attendance_records
        WHERE class_session_id = ? AND (
          (status = 'pending' AND checked_in_at IS NOT NULL) OR
          (status IN ('present', 'late') AND checked_in_at IS NULL))`,
        [session.id],
      );
      if (Number(conflicts.total) > 0)
        fail(
          409,
          'ATTENDANCE_DATA_CONFLICT',
          'Attendance records for this class session are inconsistent.',
        );
      const updated = await manager.query<{ affectedRows: number }>(
        `UPDATE attendance_records SET status = 'absent'
        WHERE class_session_id = ? AND status = 'pending'`,
        [session.id],
      );
      const inserted = await manager.query<{ affectedRows: number }>(
        `INSERT INTO attendance_records (class_session_id, student_id, status)
        SELECT ?, e.student_id, 'absent' FROM enrolments e
        WHERE e.class_id = ? AND NOT EXISTS (
          SELECT 1 FROM attendance_records r
          WHERE r.class_session_id = ? AND r.student_id = e.student_id)`,
        [session.id, session.class_id, session.id],
      );
      const marked = updated.affectedRows + inserted.affectedRows;
      return result(marked > 0 ? 'finalised' : 'already_finalised', marked);
    });
  }
}
