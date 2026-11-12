import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Announcement } from './announcement.schema';
import { User } from './user.schema';

@Entity('announcement_comments')
@Index('ix_announcement_comments_post', ['announcement_id', 'created_at', 'id'])
@Index('ix_announcement_comments_author', ['author_id'])
export class AnnouncementComment {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'int', unsigned: true })
  announcement_id!: number;

  @Column({ type: 'int', unsigned: true })
  author_id!: number;

  @Column({ type: 'varchar', length: 1000 })
  body!: string;

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
  @JoinColumn({ name: 'author_id' })
  author?: User;
}
