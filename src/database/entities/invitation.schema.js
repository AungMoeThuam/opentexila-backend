import { EntitySchema } from 'typeorm';
import {
  idColumn,
  referenceColumn,
  auditColumns,
  dateColumn,
  relation,
} from './columns';

export const InvitationSchema = new EntitySchema({
  name: 'AccountInvitation',
  tableName: 'account_invitations',
  columns: {
    id: idColumn(),
    user_id: referenceColumn(),
    created_by: referenceColumn(),
    token_hash: {
      type: 'char',
      length: 64,
      charset: 'ascii',
      collation: 'ascii_bin',
      select: false,
    },
    expires_at: dateColumn(),
    used_at: dateColumn(true),
    revoked_at: dateColumn(true),
    outstanding_user_id: {
      type: 'int',
      unsigned: true,
      nullable: true,
      asExpression: 'IF(used_at IS NULL AND revoked_at IS NULL, user_id, NULL)',
      generatedType: 'VIRTUAL',
      insert: false,
      update: false,
      select: false,
    },
    ...auditColumns(),
  },
  relations: {
    user: relation('User', 'user_id'),
    creator: relation('User', 'created_by'),
  },
  indices: [
    { name: 'uq_invitations_token', unique: true, columns: ['token_hash'] },
    {
      name: 'uq_invitations_outstanding',
      unique: true,
      columns: ['outstanding_user_id'],
    },
    {
      name: 'ix_invitations_user',
      columns: ['user_id', 'used_at', 'revoked_at'],
    },
    { name: 'ix_invitations_expiry', columns: ['expires_at'] },
    { name: 'ix_invitations_creator', columns: ['created_by'] },
  ],
});
