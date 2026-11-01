import { EntitySchema } from 'typeorm';
import { keyReferenceColumn, dateColumn, relation } from './columns';
import type { ClassSessionEntity } from './class-session.schema';
import type { UserEntity } from './user.schema';

export type AttendanceStatus = 'pending' | 'present' | 'late' | 'absent';

export interface AttendanceRecordEntity {
  class_session_id: number;
  student_id: number;
  status: AttendanceStatus;
  checked_in_at: Date | null;
  distance_m: string | number | null;
  classSession?: ClassSessionEntity;
  student?: UserEntity;
}

export const AttendanceRecordSchema = new EntitySchema<AttendanceRecordEntity>({
  name: 'AttendanceRecord',
  tableName: 'attendance_records',
  columns: {
    class_session_id: keyReferenceColumn(),
    student_id: keyReferenceColumn(),
    status: {
      type: 'enum',
      enum: ['pending', 'present', 'late', 'absent'],
      collation: 'utf8mb4_0900_as_cs',
      default: 'pending',
    },
    checked_in_at: dateColumn(true),
    distance_m: { type: 'decimal', precision: 10, scale: 2, nullable: true },
  },
  relations: {
    classSession: relation('ClassSession', 'class_session_id'),
    student: relation('User', 'student_id'),
  },
  indices: [
    { name: 'ix_records_student', columns: ['student_id'] },
    { name: 'ix_records_roster', columns: ['class_session_id', 'status'] },
  ],
});
