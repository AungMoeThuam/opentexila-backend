import { EntitySchema } from 'typeorm';
import { idColumn } from './columns';

export interface CourseEntity {
  id: number;
  code: string;
  name: string;
}

export const CourseSchema = new EntitySchema<CourseEntity>({
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
  },
  indices: [{ name: 'uq_courses_code', unique: true, columns: ['code'] }],
});
