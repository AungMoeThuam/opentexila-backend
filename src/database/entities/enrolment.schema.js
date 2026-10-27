import { EntitySchema } from 'typeorm';
import {
  idColumn,
  referenceColumn,
  auditColumns,
  dateColumn,
  relation,
} from './columns';

export const EnrolmentSchema = new EntitySchema({
  name: 'Enrolment',
  tableName: 'enrolments',
  columns: {
    id: idColumn(),
    classroom_id: referenceColumn(),
    student_id: referenceColumn(),
    enrolled_at: dateColumn(),
    withdrawn_at: dateColumn(true),
    active_student_id: {
      type: 'int',
      unsigned: true,
      nullable: true,
      asExpression: 'IF(withdrawn_at IS NULL, student_id, NULL)',
      generatedType: 'VIRTUAL',
      insert: false,
      update: false,
      select: false,
    },
    ...auditColumns(),
  },
  relations: {
    classroom: relation('Classroom', 'classroom_id'),
    student: relation('User', 'student_id'),
  },
  indices: [
    {
      name: 'uq_enrolments_current',
      unique: true,
      columns: ['classroom_id', 'active_student_id'],
    },
    {
      name: 'ix_enrolments_class_student',
      columns: ['classroom_id', 'student_id', 'withdrawn_at'],
    },
    {
      name: 'ix_enrolments_student',
      columns: ['student_id', 'withdrawn_at', 'classroom_id'],
    },
  ],
});
