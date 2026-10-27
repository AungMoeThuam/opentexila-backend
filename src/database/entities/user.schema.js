import { EntitySchema } from 'typeorm';
import { idColumn, auditColumns, dateColumn } from './columns';

export const UserSchema = new EntitySchema({
  name: 'User',
  tableName: 'users',
  columns: {
    id: idColumn(),
    name: { type: 'varchar', length: 150 },
    email: { type: 'varchar', length: 254, collation: 'utf8mb4_0900_as_ci' },
    institution_member_id: {
      type: 'varchar',
      length: 50,
      charset: 'ascii',
      collation: 'ascii_bin',
    },
    password_hash: {
      type: 'varchar',
      length: 255,
      nullable: true,
      select: false,
    },
    role: { type: 'varchar', length: 20, collation: 'utf8mb4_0900_as_cs' },
    status: {
      type: 'varchar',
      length: 20,
      collation: 'utf8mb4_0900_as_cs',
      default: 'invited',
    },
    activated_at: dateColumn(true),
    session_version: { type: 'int', unsigned: true, default: 0 },
    ...auditColumns(),
  },
  indices: [
    { name: 'uq_users_email', unique: true, columns: ['email'] },
    {
      name: 'uq_users_member_id',
      unique: true,
      columns: ['institution_member_id'],
    },
    { name: 'ix_users_role_status', columns: ['role', 'status', 'id'] },
  ],
});
