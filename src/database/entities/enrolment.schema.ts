import { EntitySchema } from 'typeorm';
import { keyReferenceColumn, relation } from './columns';
import type { ClassEntity } from './class.schema';
import type { UserEntity } from './user.schema';

export interface EnrolmentEntity {
  class_id: number;
  student_id: number;
  class?: ClassEntity;
  student?: UserEntity;
}

export const EnrolmentSchema = new EntitySchema<EnrolmentEntity>({
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
