import { EntitySchema } from 'typeorm';
import {
  idColumn,
  referenceColumn,
  dateColumn,
  relation,
  locationColumns,
} from './columns';
import type { ClassEntity } from './class.schema';

export type ClassSessionState = 'scheduled' | 'cancelled';

export interface ClassSessionEntity {
  id: number;
  class_id: number;
  room_label: string;
  latitude: string | number;
  longitude: string | number;
  radius_m: string | number;
  starts_at: Date;
  late_after: Date;
  ends_at: Date;
  state: ClassSessionState;
  class?: ClassEntity;
}

// One concrete scheduled occurrence. Recurring timetable generation belongs to a future service.
export const ClassSessionSchema = new EntitySchema<ClassSessionEntity>({
  name: 'ClassSession',
  tableName: 'class_sessions',
  columns: {
    id: idColumn(),
    class_id: referenceColumn(),
    room_label: { type: 'varchar', length: 100 },
    ...locationColumns(),
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
