import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Class, type ClassEntity } from './class.schema';

export type ClassSessionState = 'scheduled' | 'cancelled';

@Entity('class_sessions')
@Index('uq_class_sessions_class_start', ['class_id', 'starts_at'], {
  unique: true,
})
@Index('ix_class_sessions_due', ['state', 'starts_at', 'ends_at'])
export class ClassSession {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'int', unsigned: true })
  class_id!: number;

  @Column({ type: 'varchar', length: 100 })
  room_label!: string;

  @Column({ type: 'decimal', precision: 9, scale: 6 })
  latitude!: string | number;

  @Column({ type: 'decimal', precision: 9, scale: 6 })
  longitude!: string | number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  radius_m!: string | number;

  @Column({ type: 'datetime', precision: 3 })
  starts_at!: Date;

  @Column({ type: 'datetime', precision: 3 })
  late_after!: Date;

  @Column({ type: 'datetime', precision: 3 })
  ends_at!: Date;

  @Column({
    type: 'enum',
    enum: ['scheduled', 'cancelled'],
    collation: 'utf8mb4_0900_as_cs',
    default: 'scheduled',
  })
  state!: ClassSessionState;

  @ManyToOne(() => Class, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'class_id' })
  class?: ClassEntity;
}

export type ClassSessionEntity = ClassSession;
export const ClassSessionSchema = ClassSession;
