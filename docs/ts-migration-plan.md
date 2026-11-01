# NestJS Backend JS-to-TS Migration Plan

This document tracks the incremental, batch-by-batch migration of `backend/` from JavaScript (Babel) to TypeScript (`tsc`), ensuring `npm test` (73 unit/HTTP tests) and `npm run test:db` (19 MySQL integration tests) pass after every batch.

## Strategy

- Use `tsc` with `"allowJs": true` in `tsconfig.json` during the transition so `.ts` and `.js` files compile together into `dist/`.
- Replace Babel legacy parameter decorator workarounds (`Inject(DATABASE)(Service, undefined, 0)`, `Req()(Controller.prototype, ...)`) with native TypeScript parameter decorators (`@Inject(DATABASE)`, `@Req()`, `@Query()`, `@Param()`).
- Disable `"allowJs"` once 100% of `src/` is migrated to `.ts`.

---

## Batches (All Completed)

### Batch 1: TypeScript Compiler & Toolchain Setup (Completed — `c8d65bd`)

- Installed `typescript`, `@types/node`, and `@types/express`; removed `@babel/*` packages.
- Replaced `jsconfig.json` and `.babelrc` with `tsconfig.json` (`target: "ES2022"`, `module: "CommonJS"`, `rootDir: "src"`, `outDir: "dist"`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`).
- Updated `nest-cli.json`, `nodemon.json`, `Dockerfile`, and `package.json` formatting/build scripts.
- Verified `npm test` (73/73) and `npm run test:db` (19/19).

### Batch 2: Common Utilities (`src/common/*`) (Completed — `2d8f553`)

- `src/common/api-exception.js` -> `.ts`
- `src/common/api-exception.filter.js` -> `.ts`
- `src/common/query-reader.js` -> `.ts`
- Verified `npm test` (73/73).

### Batch 3: Database Layer (`src/database/**`) (Completed — `d557356`)

- `src/database/database.constants.js` -> `.ts`
- `src/database/entities/columns.js` -> `.ts`
- `src/database/entities/*.schema.js` & `index.js` -> `.ts` (with exported TypeScript entity interfaces)
- `src/database/database-options.js`, `data-source.js`, `database.module.js` -> `.ts`
- Verified `npm test` (73/73) and `npm run test:db` (19/19).

### Batch 4: Dev Auth, Examples & Root App (`src/dev/*`, `src/examples/*`, `src/app.module.js`, `src/main.js`) (Completed — `6a9b018`)

- `src/dev/dev-auth.js`, `src/dev/dev-auth.module.js` -> `.ts`
- `src/examples/classrooms-example.service.js`, `classrooms-example.controller.js`, `examples.module.js` -> `.ts`
- `src/app.module.js`, `src/main.js` -> `.ts`
- Verified `npm test` (73/73) and `npm run test:db` (19/19).

### Batch 5: Attendance Module (`src/attendance/*`) (Completed — `70ced05`)

- `src/attendance/class-summary.js`, `attendance.rules.js`, `attendance.filter.js`, `attendance.guard.js` -> `.ts`
- `src/attendance/roster.service.js`, `attendance.service.js`, `attendance-history.service.js`, `class-session-records.service.js` -> `.ts`
- `src/attendance/attendance.controller.js`, `me-attendance-records.controller.js`, `class-session-records.controller.js`, `attendance.module.js` -> `.ts`
- Set `"allowJs": false` in `tsconfig.json`.
- Verified `npm test` (73/73) and `npm run test:db` (19/19).

### Batch 6: Documentation & Final Polish (Completed)

- Updated `docs/TEAM_GUIDE.md` and `README.md` to reflect TypeScript workflow instead of Babel.
- Final test & format verification passed (`npm run format:check`, `npm test`, `npm run test:db`).
