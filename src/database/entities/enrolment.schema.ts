import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Class, type ClassEntity } from './class.schema';
import { User, type UserEntity } from './user.schema';

@Entity('enrolments')
@Index('ix_enrolments_student', ['student_id'])
export class Enrolment {
  @PrimaryColumn({ type: 'int', unsigned: true })
  class_id!: number;

  @PrimaryColumn({ type: 'int', unsigned: true })
  student_id!: number;

  @ManyToOne(() => Class, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'class_id' })
  class?: ClassEntity;

  @ManyToOne(() => User, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'student_id' })
  student?: UserEntity;
}

export type EnrolmentEntity = Enrolment;
export const EnrolmentSchema = Enrolment;
