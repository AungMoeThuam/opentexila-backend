# Sample classroom API

Implemented in TypeScript as a reference for teammates. These read-only routes use the real shared TypeORM connection and existing classroom schema. They are registered **only when `NODE_ENV=development`**, because these sample routes do not enforce authentication or membership permissions. Use a local demo database. These are examples, not the production classroom API contract.

## Try it

Run `npm run stack:up` from the backend to start MySQL, apply migrations and start both applications. Alternatively, follow the [README host workflow](../../README.md#start-locally-without-application-containers) to run NestJS outside Docker. Demo seeding is optional in either workflow; an unseeded database returns an empty list. Do not start a second host API on the stack’s API port.

```sh
curl 'http://127.0.0.1:3000/api/v1/examples/classrooms?page=1&limit=20'
# Replace 1 with an ID returned by the list; seed IDs are not guaranteed.
curl 'http://127.0.0.1:3000/api/v1/examples/classrooms/1'
```

The shared-stack frontend proxy also exposes these paths at `http://localhost:5173/api/v1/examples/classrooms` (default ports).

No authentication headers or request bodies are required for these development examples. No write routes are provided.

The existing `/examples/classrooms` URLs, controller/service filenames and error text are retained for compatibility. The underlying entity is `Class`, stored in `classes`. A URL name does not imply an old database table.

## GET /examples/classrooms

Returns classes in ascending ID order. Optional query parameters:

| Parameter | Default | Allowed values          |
| --------- | ------- | ----------------------- |
| `page`    | 1       | Integer from 1 to 10000 |
| `limit`   | 20      | Integer from 1 to 100   |

Values must be digit strings starting with 1–9. Empty, repeated, negative, decimal and exponent values are rejected. Unknown query parameters are ignored.

Example `200 OK` (fictional values):

```json
{
  "data": [
    {
      "id": 1,
      "section": "DEMO",
      "course": {
        "id": 1,
        "code": "COS30043",
        "name": "Interface Design and Development"
      },
      "term": "DEMO",
      "room_label": "Demo room"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

An empty database returns `data: []`, `total: 0`, `totalPages: 0`. A page beyond the results returns an empty array with the actual total.

## GET /examples/classrooms/:id

Accepts a positive integer ID from 1 to 4294967295. Returns `200 OK` with `{ "data": { ... } }` using the same classroom fields above. A missing classroom returns `404 Not Found`.

Only classroom `id`, `section`, `term`, `room_label`, and nested `course: { id, code, name }` are returned. The service loads the course relation and explicitly maps its fields. Coordinates, geofence configuration, teacher information and other entity fields are excluded. Class rows do not contain course code/name/subject duplicates.

This replaces the earlier flat classroom payload. Clients should use `course.code` and `course.name`, and display the separate `section`. Apply the consolidated initial migration to a fresh database before running this API. Existing old development databases need separate recreation; see the [baseline setup guide](../database-refactor-migration.md).

## Errors

These examples use Nest's built-in error responses, not the proposed application error format or 422 validation convention in the other API drafts:

```json
{
  "message": "limit must be an integer between 1 and 100.",
  "error": "Bad Request",
  "statusCode": 400
}
```

- **400**: invalid pagination or ID.
- **404**: classroom missing, or sample routes not registered outside development.
- **500**: unexpected server/database error; database details are not returned to the client.

## Pattern to follow

```text
src/examples/
  examples.module.ts               # Register controller and service
  classrooms-example.controller.ts # Routes and runtime input validation
  classrooms-example.service.ts    # Repository queries and response mapping
test/examples.test.ts              # HTTP behavior with a fake repository
```

The controller delegates to the service using NestJS dependency injection. The service injects the shared TypeORM connection and obtains a repository for `ClassSchema`; it does not create another connection. Standard TypeScript decorators (`@Controller`, `@Get`, `@Query`, `@Param`) and parameter properties supply clean injection and routing.

For real features, follow this layout in the relevant feature folder and use NestJS guards, `@CurrentUser()`, and class-validator DTOs before exposing data. Scope database queries and pagination totals to authorized records. Agree the production validation/error contract with the frontend; do not simply enable these examples in production.

Run `npm test` for HTTP routing, DI, validation, pagination, response-field filtering, errors and development-only registration checks. The HTTP tests use a fake repository; they do not verify live MySQL queries. The separate `npm run test:db` suite now passes against disposable MySQL 8.4 and verifies fresh baseline installation, populated rollback/reapplication, seeds, constraints, connection lifecycle and sample service queries with real course joins. HTTP routing is tested separately with fake repositories.
