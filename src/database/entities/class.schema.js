import { EntitySchema } from 'typeorm';
import {
  idColumn,
  referenceColumn,
  relation,
  locationColumns,
} from './columns';

// One offering of a course: a term, a section and a lecturer.
export const ClassSchema = new EntitySchema({
  name: 'Class',
  tableName: 'classes',
  columns: {
    id: idColumn(),
    course_id: referenceColumn(),
    section: {
      type: 'varchar',
      length: 30,
      charset: 'ascii',
      collation: 'ascii_bin',
    },
    term: { type: 'varchar', length: 50 },
    teacher_id: referenceColumn(),
    room_label: { type: 'varchar', length: 100 },
    ...locationColumns(),
  },
  relations: {
    teacher: relation('User', 'teacher_id'),
    course: relation('Course', 'course_id'),
  },
  indices: [
    {
      name: 'uq_classes_course_term_section',
      unique: true,
      columns: ['course_id', 'term', 'section'],
    },
    { name: 'ix_classes_teacher', columns: ['teacher_id'] },
  ],
});
