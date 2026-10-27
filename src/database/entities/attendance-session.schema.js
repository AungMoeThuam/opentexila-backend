import { EntitySchema } from 'typeorm';
import {
  idColumn,
  referenceColumn,
  auditColumns,
  dateColumn,
  relation,
  locationColumns,
} from './columns';

export const AttendanceSessionSchema = new EntitySchema({
  name: 'AttendanceSession',
  tableName: 'attendance_sessions',
  columns: {
    id: idColumn(),
    meeting_id: referenceColumn(),
    opens_at: dateColumn(),
    late_after: dateColumn(),
    closes_at: dateColumn(),
    closed_at: dateColumn(true),
    state: {
      type: 'varchar',
      length: 20,
      collation: 'utf8mb4_0900_as_cs',
      default: 'open',
    },
    room_label: { type: 'varchar', length: 100 },
    ...locationColumns(),
    cancelled_at: dateColumn(true),
    cancelled_by: referenceColumn(true),
    cancellation_reason: { type: 'varchar', length: 500, nullable: true },
    ...auditColumns(),
  },
  relations: {
    meeting: relation('ClassMeeting', 'meeting_id'),
    cancelledBy: relation('User', 'cancelled_by', true),
  },
  indices: [
    { name: 'uq_sessions_meeting', unique: true, columns: ['meeting_id'] },
    { name: 'ix_sessions_closing', columns: ['state', 'closes_at'] },
    { name: 'ix_sessions_canceller', columns: ['cancelled_by'] },
  ],
});
