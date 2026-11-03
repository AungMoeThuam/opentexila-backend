import {
  Entity,
  PrimaryColumn,
  Column,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.schema';

@Entity('auth_refresh_sessions')
@Index('ix_refresh_user', ['user_id'])
@Index('ix_refresh_expiry', ['expires_at'])
export class RefreshSession {
  @PrimaryColumn({ type: 'char', length: 36, collation: 'ascii_bin' })
  id!: string;

  @Column({ type: 'int', unsigned: true })
  user_id!: number;

  @Column({ type: 'char', length: 64, collation: 'ascii_bin', select: false })
  token_hash!: string;

  @Column({ type: 'datetime', precision: 3 })
  expires_at!: Date;

  @Column({ type: 'datetime', precision: 3, nullable: true })
  revoked_at!: Date | null;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', onUpdate: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user?: User;
}
