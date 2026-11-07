import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Course, type CourseEntity } from './course.schema';
import { User, type UserEntity } from './user.schema';

@Entity('classes')
@Index('uq_classes_course_term_section', ['course_id', 'term', 'section'], {
  unique: true,
})
@Index('ix_classes_lecturer', ['lecturer_id'])
export class Class {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'int', unsigned: true })
  course_id!: number;

  @Column({
    type: 'varchar',
    length: 30,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  section!: string;

  @Column({ type: 'varchar', length: 50 })
  term!: string;

  @Column({ type: 'int', unsigned: true })
  lecturer_id!: number;

  @Column({ type: 'varchar', length: 100 })
  room_label!: string;

  @Column({ type: 'decimal', precision: 9, scale: 6 })
  latitude!: string | number;

  @Column({ type: 'decimal', precision: 9, scale: 6 })
  longitude!: string | number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  radius_m!: string | number;

  @ManyToOne(() => User, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'lecturer_id' })
  lecturer?: UserEntity;

  @ManyToOne(() => Course, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'course_id' })
  course?: CourseEntity;
}

export type ClassEntity = Class;
export const ClassSchema = Class;
