import {
  Entity,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Announcement } from './announcement.schema';
import { User } from './user.schema';

// One row per (announcement, user), so a user likes a post at most once.
@Entity('announcement_likes')
@Index('ix_announcement_likes_user', ['user_id'])
export class AnnouncementLike {
  @PrimaryColumn({ type: 'int', unsigned: true })
  announcement_id!: number;

  @PrimaryColumn({ type: 'int', unsigned: true })
  user_id!: number;

  @CreateDateColumn({
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  created_at!: Date;

  @ManyToOne(() => Announcement, {
    onDelete: 'CASCADE',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'announcement_id' })
  announcement?: Announcement;

  @ManyToOne(() => User, {
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
    nullable: false,
  })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
