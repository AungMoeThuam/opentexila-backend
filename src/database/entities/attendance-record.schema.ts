import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ClassSession, type ClassSessionEntity } from './class-session.schema';
import { User, type UserEntity } from './user.schema';

export type AttendanceStatus = 'pending' | 'present' | 'late' | 'absent';

@Entity('attendance_records')
@Index('ix_records_student', ['student_id'])
@Index('ix_records_roster', ['class_session_id', 'status'])
export class AttendanceRecord {
  @PrimaryColumn({ type: 'int', unsigned: true })
  class_session_id!: number;

  @PrimaryColumn({ type: 'int', unsigned: true })
  student_id!: number;

  @Column({
    type: 'enum',
    enum: ['pending', 'present', 'late', 'absent'],
    collation: 'utf8mb4_0900_as_cs',
    default: 'pending',
  })
  status!: AttendanceStatus;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  checked_in_at!: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  distance_m!: string | number | null;

  @ManyToOne(() => ClassSession, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'class_session_id' })
  classSession?: ClassSessionEntity;

  @ManyToOne(() => User, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'student_id' })
  student?: UserEntity;
}

export type AttendanceRecordEntity = AttendanceRecord;
export const AttendanceRecordSchema = AttendanceRecord;
