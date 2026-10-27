import { EntitySchema } from 'typeorm';
import {
  idColumn,
  referenceColumn,
  auditColumns,
  dateColumn,
  relation,
} from './columns';

export const AttendanceRecordSchema = new EntitySchema({
  name: 'AttendanceRecord',
  tableName: 'attendance_records',
  columns: {
    id: idColumn(),
    session_id: referenceColumn(),
    student_id: referenceColumn(),
    status: {
      type: 'varchar',
      length: 20,
      collation: 'utf8mb4_0900_as_cs',
      default: 'pending',
    },
    checked_in_at: dateColumn(true),
    distance_m: { type: 'decimal', precision: 10, scale: 2, nullable: true },
    accuracy_m: { type: 'decimal', precision: 10, scale: 2, nullable: true },
    location_validated_at: dateColumn(true),
    ...auditColumns(),
  },
  relations: {
    session: relation('AttendanceSession', 'session_id'),
    student: relation('User', 'student_id'),
  },
  indices: [
    {
      name: 'uq_records_session_student',
      unique: true,
      columns: ['session_id', 'student_id'],
    },
    { name: 'ix_records_student', columns: ['student_id', 'session_id'] },
    { name: 'ix_records_roster', columns: ['session_id', 'status', 'id'] },
  ],
});
