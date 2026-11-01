import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ensureEnvironment, ensureFrontend } from '../scripts/stack.ts';

function temporaryDirectory(t: any): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'opentexila-stack-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('first-run configuration generates passwords and never overwrites existing settings', (t) => {
  const dir = temporaryDirectory(t);
  writeFileSync(
    path.join(dir, '.env.example'),
    'DB_PASSWORD=replace-with-local-app-password\nDB_ROOT_PASSWORD=replace-with-local-root-password\n',
  );
  assert.equal(ensureEnvironment(dir), true);
  const original = readFileSync(path.join(dir, '.env'), 'utf8');
  const env = parseEnv(original);
  assert.match(env.DB_PASSWORD!, /^[a-f0-9]{48}$/);
  assert.notEqual(env.DB_PASSWORD, env.DB_ROOT_PASSWORD);
  assert.equal(ensureEnvironment(dir), false);
  assert.equal(readFileSync(path.join(dir, '.env'), 'utf8'), original);
});

test('clones a missing repository, then preserves uncommitted frontend work on rerun', (t) => {
  const dir = temporaryDirectory(t);
  const source = path.join(dir, 'source repo');
  const destination = path.join(dir, 'frontend checkout');
  mkdirSync(source);
  for (const entry of ['src', 'public']) {
    mkdirSync(path.join(source, entry));
    writeFileSync(path.join(source, entry, '.gitkeep'), '');
  }
  for (const entry of ['package-lock.json', 'vite.config.js', 'index.html'])
    writeFileSync(path.join(source, entry), '{}');
  writeFileSync(
    path.join(source, 'package.json'),
    JSON.stringify({ name: 'opentexila-frontend', scripts: { dev: 'vite' } }),
  );
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: source, stdio: 'pipe' });
  git(['init', '-q']);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Stack Test',
    '-c',
    'user.email=stack@example.test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'fixture',
  ]);
  ensureFrontend(destination, source);
  assert.ok(existsSync(path.join(destination, '.git')));
  writeFileSync(path.join(destination, 'index.html'), 'unfinished local UI');
  // An invalid URL proves an existing checkout does not fetch or pull.
  ensureFrontend(destination, 'invalid://must-not-be-used', () => {
    assert.fail('Existing checkout must never run Git commands.');
  });
  assert.equal(
    readFileSync(path.join(destination, 'index.html'), 'utf8'),
    'unfinished local UI',
  );
});

test('an unrelated existing folder is rejected without cloning into or replacing it', (t) => {
  const dir = temporaryDirectory(t);
  writeFileSync(path.join(dir, 'keep.txt'), 'keep me');
  assert.throws(
    () => ensureFrontend(dir, 'unused', () => assert.fail('Must not clone.')),
    /missing .git/,
  );
  assert.equal(readFileSync(path.join(dir, 'keep.txt'), 'utf8'), 'keep me');
});

test('clone failure stops setup before proceeding to build the frontend', (t) => {
  const destination = path.join(temporaryDirectory(t), 'missing');
  assert.throws(
    () =>
      ensureFrontend(destination, 'https://example.test/private.git', () => {
        throw new Error('Git authentication failed');
      }),
    /Git authentication failed/,
  );
  assert.equal(existsSync(destination), false);
});
