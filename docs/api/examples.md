# Sample classroom API

Implemented in JavaScript as a reference for teammates. These read-only routes use the real shared TypeORM connection and existing classroom schema. They are registered **only when `NODE_ENV=development`**, because authentication and membership permissions are not implemented yet. Use a local demo database. These are examples, not the production classroom API contract.

## Try it

Run `npm run stack:up` from the backend to start MySQL, apply migrations and start both applications. Alternatively, follow the [README host workflow](../../README.md#start-locally-without-application-containers) to run NestJS outside Docker. Demo seeding is optional in either workflow; an unseeded database returns an empty list. Do not start a second host API on the stack’s API port.

```sh
curl 'http://127.0.0.1:3000/api/v1/examples/classrooms?page=1&limit=20'
# Replace 1 with an ID returned by the list; seed IDs are not guaranteed.
curl 'http://127.0.0.1:3000/api/v1/examples/classrooms/1'
```

The shared-stack frontend proxy also exposes these paths at `http://localhost:5173/api/v1/examples/classrooms` (default ports).

No authentication headers or request bodies are required for these development examples. No write routes are provided.

## GET /examples/classrooms

Returns non-archived classrooms in ascending ID order. Optional query parameters:

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

Accepts a positive integer ID from 1 to 4294967295. Returns `200 OK` with `{ "data": { ... } }` using the same classroom fields above. A missing or archived classroom returns `404 Not Found`.

Only classroom `id`, `section`, `term`, `room_label`, and nested `course: { id, code, name }` are returned. The service loads the course relation and explicitly maps its fields. Legacy classroom `code`, `name`, and `subject`, coordinates, geofence configuration, teacher information and other entity fields are excluded.

This replaces the earlier flat classroom payload. Clients should use `course.code` and `course.name`, and display the separate `section`. Apply `1793145600000-CourseSections.js` before running this API. See the [migration checkpoint](../course-section-migration-plan.md) for the known demo mapping and upgrade precautions.

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
- **404**: classroom missing/archived, or sample routes not registered outside development.
- **500**: unexpected server/database error; database details are not returned to the client.

## Pattern to follow

```text
src/examples/
  examples.module.js               # Register controller and service
  classrooms-example.controller.js # Routes and runtime input validation
  classrooms-example.service.js    # Repository queries and response mapping
test/examples.test.js              # HTTP behavior with a fake repository
```

The controller delegates to the service. The service injects `DATABASE` and obtains a repository for `ClassroomSchema`; it does not create another connection. Explicit `Inject`, `Query` and `Param` calls supply decorator metadata in plain JavaScript with Babel. No TypeScript or additional validation library is required for these simple parameters.

For real features, follow this layout in the relevant feature folder and add account, role and membership checks before exposing data. Scope database queries and pagination totals to authorized records. Agree the production validation/error contract with the frontend; do not simply enable these examples in production.

Run `npm test` for HTTP routing, DI, validation, pagination, response-field filtering, errors and development-only registration checks. The HTTP tests use a fake repository; they do not verify live MySQL queries. The separate `npm run test:db` suite now passes against disposable MySQL 8.4 and verifies fresh/legacy migrations, seeds, constraints, connection lifecycle and sample service queries with real course joins. HTTP routing is tested separately with fake repositories.
