import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Class, type ClassEntity } from './class.schema';
import { User, type UserEntity } from './user.schema';

export const ANNOUNCEMENT_CATEGORIES = [
  'general',
  'class_change',
  'reminder',
  'exam',
] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

@Entity('announcements')
@Index('ix_announcements_class_created', ['class_id', 'created_at', 'id'])
@Index('ix_announcements_author', ['author_id'])
export class Announcement {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'int', unsigned: true })
  class_id!: number;

  @Column({ type: 'int', unsigned: true })
  author_id!: number;

  @Column({
    type: 'enum',
    enum: ANNOUNCEMENT_CATEGORIES,
    collation: 'utf8mb4_0900_as_cs',
    default: 'general',
  })
  category!: AnnouncementCategory;

  @Column({ type: 'varchar', length: 150 })
  title!: string;

  @Column({ type: 'varchar', length: 5000 })
  body!: string;

  @CreateDateColumn({
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  created_at!: Date;

  @Column({
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  updated_at!: Date;

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
  @JoinColumn({ name: 'author_id' })
  author?: UserEntity;
}

export type AnnouncementEntity = Announcement;
export const AnnouncementSchema = Announcement;
