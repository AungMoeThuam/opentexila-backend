import { EntitySchema } from 'typeorm';
import {
  idColumn,
  referenceColumn,
  auditColumns,
  dateColumn,
  relation,
} from './columns';

// One concrete scheduled occurrence. Recurring timetable generation belongs to a future service.
export const MeetingSchema = new EntitySchema({
  name: 'ClassMeeting',
  tableName: 'class_meetings',
  columns: {
    id: idColumn(),
    classroom_id: referenceColumn(),
    starts_at: dateColumn(),
    late_after: dateColumn(),
    ends_at: dateColumn(),
    state: {
      type: 'varchar',
      length: 20,
      collation: 'utf8mb4_0900_as_cs',
      default: 'scheduled',
    },
    created_by: referenceColumn(),
    cancelled_at: dateColumn(true),
    cancelled_by: referenceColumn(true),
    cancellation_reason: { type: 'varchar', length: 500, nullable: true },
    ...auditColumns(),
  },
  relations: {
    classroom: relation('Classroom', 'classroom_id'),
    creator: relation('User', 'created_by'),
    cancelledBy: relation('User', 'cancelled_by', true),
  },
  indices: [
    {
      name: 'uq_meetings_class_start',
      unique: true,
      columns: ['classroom_id', 'starts_at'],
    },
    { name: 'ix_meetings_due', columns: ['state', 'starts_at', 'ends_at'] },
    { name: 'ix_meetings_creator', columns: ['created_by'] },
    { name: 'ix_meetings_canceller', columns: ['cancelled_by'] },
  ],
});
