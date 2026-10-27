import { EntitySchema } from 'typeorm';
import {
  idColumn,
  referenceColumn,
  auditColumns,
  dateColumn,
  relation,
  locationColumns,
} from './columns';

export const ClassroomSchema = new EntitySchema({
  name: 'Classroom',
  tableName: 'classrooms',
  columns: {
    id: idColumn(),
    code: {
      type: 'varchar',
      length: 30,
      charset: 'ascii',
      collation: 'ascii_bin',
    },
    name: { type: 'varchar', length: 150 },
    subject: { type: 'varchar', length: 150 },
    term: { type: 'varchar', length: 50 },
    teacher_id: referenceColumn(),
    room_label: { type: 'varchar', length: 100 },
    ...locationColumns(),
    archived_at: dateColumn(true),
    ...auditColumns(),
  },
  relations: { teacher: relation('User', 'teacher_id') },
  indices: [
    {
      name: 'uq_classrooms_code_term',
      unique: true,
      columns: ['code', 'term'],
    },
    { name: 'ix_classrooms_teacher', columns: ['teacher_id', 'archived_at'] },
  ],
});
