import { EntitySchema } from 'typeorm';
import { idColumn, auditColumns } from './columns';

export const CourseSchema = new EntitySchema({
  name: 'Course',
  tableName: 'courses',
  columns: {
    id: idColumn(),
    code: {
      type: 'varchar',
      length: 30,
      charset: 'ascii',
      collation: 'ascii_bin',
    },
    name: { type: 'varchar', length: 150 },
    ...auditColumns(),
  },
  indices: [{ name: 'uq_courses_code', unique: true, columns: ['code'] }],
});
