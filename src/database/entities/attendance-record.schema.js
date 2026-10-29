import { EntitySchema } from 'typeorm';
import { keyReferenceColumn, dateColumn, relation } from './columns';

export const AttendanceRecordSchema = new EntitySchema({
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
