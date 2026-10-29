import { EntitySchema } from 'typeorm';
import { idColumn, createdAtColumn } from './columns';

export const UserSchema = new EntitySchema({
  name: 'User',
  tableName: 'users',
  columns: {
    id: idColumn(),
    name: { type: 'varchar', length: 150 },
    email: { type: 'varchar', length: 254, collation: 'utf8mb4_0900_as_ci' },
    password_hash: { type: 'varchar', length: 255, select: false },
    role: {
      type: 'enum',
      enum: ['student', 'teacher', 'admin'],
      collation: 'utf8mb4_0900_as_cs',
    },
    status: {
      type: 'enum',
      enum: ['active', 'inactive'],
      collation: 'utf8mb4_0900_as_cs',
      default: 'active',
    },
    must_change_password: { type: 'boolean', default: true },
    session_version: { type: 'int', unsigned: true, default: 0 },
    created_at: createdAtColumn(),
  },
  indices: [
    { name: 'uq_users_email', unique: true, columns: ['email'] },
    { name: 'ix_users_role_status', columns: ['role', 'status', 'id'] },
  ],
});
