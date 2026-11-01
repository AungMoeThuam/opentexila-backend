import { EntitySchema } from 'typeorm';
import { keyReferenceColumn, relation } from './columns';

export const EnrolmentSchema = new EntitySchema({
  name: 'Enrolment',
  tableName: 'enrolments',
  columns: {
    class_id: keyReferenceColumn(),
    student_id: keyReferenceColumn(),
  },
  relations: {
    class: relation('Class', 'class_id'),
    student: relation('User', 'student_id'),
  },
  indices: [{ name: 'ix_enrolments_student', columns: ['student_id'] }],
});
