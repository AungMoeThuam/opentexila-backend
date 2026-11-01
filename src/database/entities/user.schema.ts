import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type UserRole = 'student' | 'teacher' | 'admin';
export type UserStatus = 'active' | 'inactive';

@Entity('users')
@Index('uq_users_email', ['email'], { unique: true })
@Index('ix_users_role_status', ['role', 'status', 'id'])
export class User {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id!: number;

  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 254, collation: 'utf8mb4_0900_as_ci' })
  email!: string;

  @Column({ type: 'varchar', length: 255, select: false })
  password_hash!: string;

  @Column({
    type: 'enum',
    enum: ['student', 'teacher', 'admin'],
    collation: 'utf8mb4_0900_as_cs',
  })
  role!: UserRole;

  @Column({
    type: 'enum',
    enum: ['active', 'inactive'],
    collation: 'utf8mb4_0900_as_cs',
    default: 'active',
  })
  status!: UserStatus;

  @Column({ type: 'boolean', default: true })
  must_change_password!: boolean;

  @Column({ type: 'int', unsigned: true, default: 0 })
  session_version!: number;

  @CreateDateColumn({
    type: 'datetime',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  created_at!: Date;
}

export type UserEntity = User;
export const UserSchema = User;
