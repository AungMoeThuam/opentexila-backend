# TypeScript tooling cleanup

Complete one batch per chat turn, commit the completed batch, then wait for the
user to say `continue`. Keep the existing `tsc` build and `dist/main.js` runtime.
Production Docker packaging is outside this plan.

- [x] **Batch 1 — Package tooling:** align `@types/node` with Node 22, update the
  lockfile, and add `pretypecheck`. Verify build/typecheck without an existing
  `dist` directory.
- [x] **Batch 2 — Development reload:** watch `tsconfig.build.json` in Nodemon.
  Verify that source and build-config changes trigger rebuilding.
- [x] **Batch 3 — Documentation:** update JavaScript-era migration/seed paths,
  dependency injection examples, and host/container workflow instructions.
- [x] **Batch 4 — Final verification:** run unit/HTTP tests, disposable MySQL
  tests, formatting checks, Docker build, and isolated startup/reload checks.

## Progress

Batch 1 completed on 2026-11-02:

- Updated `@types/node` to `^22.20.5` and its lockfile entry. Its `undici-types`
  dependency changed to the matching version; runtime dependencies are unchanged.
- Added `pretypecheck: npm run build` so `npm run typecheck` generates the
  declarations used by scripts and tests before checking the whole project.
- Verified `npm run typecheck` in a temporary source copy without `dist`, using
  the updated installed dependencies. The build generated `dist/main.js` and
  declarations, and strict type checking passed.
- Package JSON formatting, manifest/lockfile consistency, and `git diff --check`
  passed. The full runtime and Docker checks remain scheduled for Batch 4.

Batch 1 commit: `811b147` — `chore(tooling): align Node typings and build before typecheck`.

Batch 2 completed on 2026-11-02:

- Added `tsconfig.build.json` to Nodemon's watch list.
- Ran the actual `npm run start:dev` / `npm start` / `prestart` lifecycle in a
  temporary source copy with a minimal entry point that requires no database.
- Verified a source edit rebuilt the JavaScript and restarted the process.
- Verified changing `sourceMap` in the build config triggered another rebuild
  and restart, and removed the generated source map as expected.
- Native watcher events did not arrive inside the sandbox; the same check
  passed outside it. Temporary files and test processes were cleaned up.
- Nodemon JSON formatting and `git diff --check` passed. Docker-mounted reload
  and full application startup remain scheduled for Batch 4.

Batch 2 commit: `541cb28` — `fix(dev): rebuild when TypeScript build configuration changes`.

Batch 3 completed on 2026-11-03:

- Updated the current setup, team, database and API guides to use `.ts`
  migration/seed paths, decorated entities and typed constructor injection.
- Documented automatic builds before type checking, Nodemon's build-config
  watch, compiled application output versus type-stripped tooling, and which
  commands execute on the host or inside Docker.
- Corrected stale attendance/development-auth implementation descriptions and
  distinguished the initial baseline rollback from the later venue migration.
- Checked all npm script references, relative Markdown links and named
  migration files in the edited guides against the repository.
- Compiled both complete service examples in a temporary source copy using the
  project's strict compiler settings and installed dependencies; both passed.
- Historical implementation plans remain unchanged. No application or Docker
  configuration changed in this batch; full runtime checks remain in Batch 4.

Batch 3 commit: `af4c555` — `docs: align backend guides with TypeScript and Docker workflows`.

Batch 4 completed on 2026-11-03:

- `npm run typecheck` (including its automatic build), `npm run format:check`
  and `git diff --check` passed.
- All 71 unit/HTTP tests and all 19 disposable MySQL integration tests passed.
- Built the backend, migration and frontend Docker images from temporary source
  copies using the current Compose configuration. The isolated project used
  generated test credentials, ephemeral localhost ports and its own database
  volume; the application's `.env` and database volume were not used.
- Migrations exited successfully, and MySQL, Nest and Vite became healthy. The
  sample API queried the migrated database both directly and through Vite's
  proxy, and the frontend served HTML.
- Editing the temporary mounted TypeScript source rebuilt and restarted Nest.
  Editing the mounted `tsconfig.build.json` triggered another rebuild/restart;
  disabling source maps removed `dist/main.js.map`, confirming the changed
  compiler setting took effect. The API responded after both reloads.
- Removed the disposable stack and verified its containers, network and volume
  were gone. No application or Docker configuration fixes were needed.

All four batches are complete. Production Docker packaging remains outside this
plan.

Application refactor and unused-code cleanup were committed previously as
`8351115`.
