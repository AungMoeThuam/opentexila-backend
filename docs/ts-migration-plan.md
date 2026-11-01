# NestJS Backend JS-to-TS Migration Plan

This document tracks the incremental, batch-by-batch migration of `backend/` from JavaScript (Babel) to TypeScript (`tsc`), ensuring `npm test` (73 unit/HTTP tests) and `npm run test:db` (19 MySQL integration tests) pass after every batch.

## Strategy
- Use `tsc` with `"allowJs": true` in `tsconfig.json` during the transition so `.ts` and `.js` files compile together into `dist/`.
- Replace Babel legacy parameter decorator workarounds (`Inject(DATABASE)(Service, undefined, 0)`, `Req()(Controller.prototype, ...)`) with native TypeScript parameter decorators (`@Inject(DATABASE)`, `@Req()`, `@Query()`, `@Param()`).
- Disable `"allowJs"` once 100% of `src/` is migrated to `.ts`.

---

## Batches

### Batch 1: TypeScript Compiler & Toolchain Setup
- Install `typescript` and `@types/node` and configure `tsc` build script.
- Replace `jsconfig.json` and `.babelrc` with `tsconfig.json` (`target: "ES2022"`, `module: "CommonJS"`, `rootDir: "src"`, `outDir: "dist"`, `allowJs: true`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`).
- Update `nest-cli.json`, `nodemon.json`, `Dockerfile`, and `package.json` formatting scripts.
- Verify `npm test` and `npm run test:db`.

### Batch 2: Common Utilities (`src/common/*`)
- `src/common/api-exception.js` -> `.ts`
- `src/common/api-exception.filter.js` -> `.ts`
- `src/common/query-reader.js` -> `.ts`
- Verify `npm test`.

### Batch 3: Database Layer (`src/database/**`)
- `src/database/database.constants.js` -> `.ts`
- `src/database/entities/columns.js` -> `.ts`
- `src/database/entities/*.schema.js` & `index.js` -> `.ts` (with exported TypeScript entity interfaces)
- `src/database/database-options.js`, `data-source.js`, `database.module.js` -> `.ts`
- Verify `npm test` and `npm run test:db`.

### Batch 4: Dev Auth, Examples & Root App (`src/dev/*`, `src/examples/*`, `src/app.module.js`, `src/main.js`)
- `src/dev/dev-auth.js`, `src/dev/dev-auth.module.js` -> `.ts`
- `src/examples/classrooms-example.service.js`, `classrooms-example.controller.js`, `examples.module.js` -> `.ts`
- `src/app.module.js`, `src/main.js` -> `.ts`
- Verify `npm test`.

### Batch 5: Attendance Module (`src/attendance/*`)
- `src/attendance/class-summary.js`, `attendance.rules.js`, `attendance.filter.js`, `attendance.guard.js` -> `.ts`
- `src/attendance/roster.service.js`, `attendance.service.js`, `attendance-history.service.js`, `class-session-records.service.js` -> `.ts`
- `src/attendance/attendance.controller.js`, `me-attendance-records.controller.js`, `class-session-records.controller.js`, `attendance.module.js` -> `.ts`
- Set `"allowJs": false` in `tsconfig.json`.
- Verify `npm test` and `npm run test:db`.

### Batch 6: Documentation & Final Polish
- Update `docs/TEAM_GUIDE.md` and `README.md` to reflect TypeScript workflow instead of Babel.
- Final test & format verification.
