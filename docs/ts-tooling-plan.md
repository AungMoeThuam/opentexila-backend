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
- [ ] **Batch 4 — Final verification:** run unit/HTTP tests, disposable MySQL
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

Next: Batch 4, after the user says `continue`. The commit for Batch 3 is titled
`docs: align backend guides with TypeScript and Docker workflows`.

Application refactor and unused-code cleanup were committed previously as
`8351115`.
