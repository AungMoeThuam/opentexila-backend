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
    course_id: referenceColumn(),
    section: {
      type: 'varchar',
      length: 30,
      charset: 'ascii',
      collation: 'ascii_bin',
    },
    // Transitional columns preserve original values for guarded rollback.
    // New code must use course_id/section instead.
    code: {
      type: 'varchar',
      length: 30,
      charset: 'ascii',
      collation: 'ascii_bin',
      nullable: true,
      select: false,
    },
    name: { type: 'varchar', length: 150, nullable: true, select: false },
    subject: { type: 'varchar', length: 150, nullable: true, select: false },
    term: { type: 'varchar', length: 50 },
    teacher_id: referenceColumn(),
    room_label: { type: 'varchar', length: 100 },
    ...locationColumns(),
    archived_at: dateColumn(true),
    ...auditColumns(),
  },
  relations: {
    teacher: relation('User', 'teacher_id'),
    course: relation('Course', 'course_id'),
  },
  indices: [
    {
      name: 'uq_classrooms_course_term_section',
      unique: true,
      columns: ['course_id', 'term', 'section'],
    },
    { name: 'ix_classrooms_teacher', columns: ['teacher_id', 'archived_at'] },
  ],
});
