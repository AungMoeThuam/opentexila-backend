import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('courses')
@Index('uq_courses_code', ['code'], { unique: true })
export class Course {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({
    type: 'varchar',
    length: 30,
    charset: 'ascii',
    collation: 'ascii_bin',
  })
  code!: string;

  @Column({ type: 'varchar', length: 150 })
  name!: string;
}

export type CourseEntity = Course;
export const CourseSchema = Course;
