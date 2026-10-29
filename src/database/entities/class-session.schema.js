import { EntitySchema } from 'typeorm';
import { idColumn, referenceColumn, dateColumn, relation } from './columns';

// One concrete scheduled occurrence. Recurring timetable generation belongs to a future service.
export const ClassSessionSchema = new EntitySchema({
  name: 'ClassSession',
  tableName: 'class_sessions',
  columns: {
    id: idColumn(),
    class_id: referenceColumn(),
    starts_at: dateColumn(),
    late_after: dateColumn(),
    ends_at: dateColumn(),
    state: {
      type: 'enum',
      enum: ['scheduled', 'cancelled'],
      collation: 'utf8mb4_0900_as_cs',
      default: 'scheduled',
    },
  },
  relations: { class: relation('Class', 'class_id') },
  indices: [
    {
      name: 'uq_class_sessions_class_start',
      unique: true,
      columns: ['class_id', 'starts_at'],
    },
    {
      name: 'ix_class_sessions_due',
      columns: ['state', 'starts_at', 'ends_at'],
    },
  ],
});
