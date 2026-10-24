# OpenTexila backend

Minimal NestJS backend written in JavaScript. Generated with the installed Nest CLI 12.0.10 and simplified to an empty root module.

## Requirements

- Node.js 22.15.1 or newer (verified locally with 22.15.1).
- npm.

Babel 7 transforms JavaScript imports and Nest decorators for Node.js. There is no TypeScript source or compilation step. Build with the npm scripts below; this scaffold does not use `nest build` or `nest start`.

## Setup

Run from this directory:

```sh
npm ci
cp .env.example .env
npm run start:dev
```

The server binds to `127.0.0.1:3000` by default. `.env` is optional; the run scripts load it when present. Set `HOST` and `PORT` to change the listening address. Use `HOST=0.0.0.0` only when access from other devices is intended.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Build the source and start the server. |
| `npm run start:dev` | Rebuild and restart when source or configuration changes. |
| `npm run build` | Compile JavaScript from `src/` into `dist/`. |
| `npm run start:prod` | Run an existing build; run `npm run build` first. |
| `npm run format` | Format JavaScript source and root JSON configuration. |
| `npm run format:check` | Check formatting without changing files. |

## Structure

```text
backend/
  src/
    main.js               # Bootstrap, environment settings and API prefix
    app.module.js         # Empty root module
    auth/                 # Current focus: invitations, activation and sessions
    attendance/           # Current focus: sessions, location check-in and history
    users/                # Deferred: account management
    classrooms/           # Deferred: classes and enrolment
    announcements/        # Deferred
    resources/            # Deferred
    assignments/          # Deferred
    dashboard/            # Deferred
    common/               # Reserved for shared utilities, guards and validation
    config/               # Reserved for application configuration
    database/             # Reserved for database integration
  database/
    migrations/           # Reserved for migrations
    seeds/                # Reserved for seed data
  test/                   # Reserved for tests
  docs/
    api/
      README.md           # API overview and shared conventions
      auth.md             # Planned auth endpoints
      attendance.md       # Planned attendance endpoints
  .env.example
  .babelrc
  nest-cli.json
  nodemon.json
  package.json
  package-lock.json
```

The API prefix is `/api/v1`. No controllers or routes are implemented yet, so requests to `/` and `/api/v1` return Nest's default HTTP 404 response. This is expected for the empty scaffold.

All planned top-level backend feature folders now exist. They contain only `.gitkeep` placeholders; no feature module, controller, service, schema or database code has been generated, and `AppModule` remains empty. No test runner or deployment integration is configured yet.

## API documentation

See the [API overview](docs/api/README.md), [authentication reference](docs/api/auth.md) and [attendance reference](docs/api/attendance.md). All endpoints are currently labelled planned. These documents belong to the backend repository and can be linked from the separate frontend repository.

## Current implementation focus

Only **auth** and **attendance** are selected for the next implementation phase:

| Area | Planned responsibility |
| --- | --- |
| `src/auth/` | Institution-managed invitations, account activation, login/logout, session restoration and access checks. |
| `src/attendance/` | Full-class attendance sessions, location/code validation, Present/Late/Absent rules and attendance history. |
| `src/common/`, `src/config/`, `src/database/` | Shared support for these features when implementation begins. |

The other feature folders are reserved for later work. Attendance still needs user identities, class locations, lecturer assignments and enrolment records; the minimum supporting data and access rules must be provided when implementing attendance. Creating the folders does not implement those dependencies.

Controllers, services, runtime validation schemas and data-access files will be introduced as needed during coding, rather than generated now.

The package manifest temporarily overrides the Express adapter's Multer dependency to 2.5.0 to address advisory GHSA-q7qp-rjg7-q26m. Remove the override when Nest includes a patched version. File upload features are not implemented.
