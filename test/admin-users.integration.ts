import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import type { DataSource } from 'typeorm';
import { AdminUsersService } from '../dist/users/admin-users.service.js';
import { ApiException } from '../dist/common/api-exception.js';

const rejectsWith = (status: number, code: string) => (error: any) => {
  assert.ok(error instanceof ApiException, String(error));
  assert.equal(error.getStatus(), status);
  assert.equal(error.getResponse().error.code, code);
  return true;
};

export async function adminUsersIntegration(t: TestContext, ds: DataSource) {
  await t.test('admin account provisioning against MySQL', async (t) => {
    const service = new AdminUsersService(ds);
    const suffix = randomBytes(6).toString('hex');
    const email = `provisioned-${suffix}@example.com`;
    const password = 'Temporary-' + randomBytes(10).toString('hex');
    const next = 'Reset-temporary-' + randomBytes(10).toString('hex');
    const createdIds: number[] = [];
    // Later suites count the seeded users, so remove everything created here.
    t.after(async () => {
      if (createdIds.length) {
        await ds.query(
          'DELETE FROM auth_refresh_sessions WHERE user_id IN (?)',
          [createdIds],
        );
        await ds.query('DELETE FROM users WHERE id IN (?)', [createdIds]);
      }
    });

    const row = async (id: number) =>
      (
        await ds.query(
          'SELECT role, status, must_change_password, session_version, password_hash FROM users WHERE id = ?',
          [id],
        )
      )[0];

    let userId = 0;
    await t.test('create stores a hashed temporary password', async () => {
      const created = await service.createUser({
        name: 'Provisioned Student',
        email,
        role: 'student',
        temporary_password: password,
      });
      userId = created.data.id;
      createdIds.push(userId);
      assert.deepEqual(created.data, {
        id: userId,
        name: 'Provisioned Student',
        email,
        role: 'student',
        must_change_password: true,
        is_active: true,
      });
      const stored = await row(userId);
      assert.equal(stored.role, 'student');
      assert.equal(stored.status, 'active');
      assert.equal(Number(stored.must_change_password), 1);
      assert.match(stored.password_hash, /^\$argon2id\$/);
      assert.equal(await argon2.verify(stored.password_hash, password), true);
    });

    await t.test('a duplicate email is rejected', async () => {
      await assert.rejects(
        service.createUser({
          name: 'Other',
          email,
          role: 'lecturer',
          temporary_password: password,
        }),
        rejectsWith(409, 'EMAIL_ALREADY_EXISTS'),
      );
    });

    await t.test(
      'reset replaces the password and ends all sign-ins',
      async () => {
        await ds.query(
          `INSERT INTO auth_refresh_sessions (id, user_id, token_hash, expires_at)
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 1 DAY))`,
          [randomUUID(), userId, randomBytes(32).toString('hex')],
        );
        const before = await row(userId);
        await ds.query(
          'UPDATE users SET must_change_password = 0 WHERE id = ?',
          [userId],
        );
        await service.resetPassword(userId, { temporary_password: next });
        const after = await row(userId);
        assert.equal(Number(after.must_change_password), 1);
        assert.equal(
          Number(after.session_version),
          Number(before.session_version) + 1,
        );
        assert.equal(await argon2.verify(after.password_hash, next), true);
        assert.equal(await argon2.verify(after.password_hash, password), false);
        const [{ open }] = await ds.query(
          'SELECT COUNT(*) AS open FROM auth_refresh_sessions WHERE user_id = ? AND revoked_at IS NULL',
          [userId],
        );
        assert.equal(Number(open), 0);
      },
    );

    await t.test('reset rejects unknown users and admin accounts', async () => {
      await assert.rejects(
        service.resetPassword(4294967295, { temporary_password: next }),
        rejectsWith(404, 'RESOURCE_NOT_FOUND'),
      );
      const result: any = await ds.query(
        `INSERT INTO users (name, email, password_hash, role, status, must_change_password)
         VALUES ('Provisioning Admin', ?, 'x', 'admin', 'active', 0)`,
        [`provisioning-admin-${suffix}@example.com`],
      );
      createdIds.push(result.insertId);
      await assert.rejects(
        service.resetPassword(result.insertId, { temporary_password: next }),
        rejectsWith(403, 'FORBIDDEN'),
      );
      assert.equal((await row(result.insertId)).password_hash, 'x');
    });
  });
}
