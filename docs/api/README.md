# OpenTexila API documentation

**Status: database foundation and development-only sample API implemented.** The backend connects to MySQL through a shared TypeORM provider. The [sample classroom API](examples.md) provides two working read routes. Authentication, enrolment and attendance APIs remain planned. Start with the [database design](../database-design.md) and [developer guide](../database-development.md).

This documentation belongs to the backend repository. The separate frontend repository should link to it rather than duplicate the API contract.

## Feature references

- [Sample classroom API](examples.md) — implemented development-only list/detail endpoints and a code pattern for teammates.
- [Authentication](auth.md) — invitations, activation, login, logout and session restoration.
- [Attendance](attendance.md) — sessions, location check-in and attendance history.

Enrolment contracts are not documented yet. Agree their paths, payloads and write permissions before implementation; student self-enrolment remains undecided. The schema supports membership intervals, but does not choose that policy. The sample classroom routes are not the production enrolment API.

## Base URL

Local development: `http://127.0.0.1:3000/api/v1` with the default host and port. For the shared Docker stack, the browser uses `/api/v1` through `http://localhost:5173`; Vite proxies to the API. `BACKEND_PORT` and `FRONTEND_DEV_PORT` can change those host ports; see [Docker configuration](../DOCKER.md#configuration). The deployed URL is not decided yet. Paths in the feature documents are relative to `/api/v1`.

Separate source repositories do not require separate hosting origins. If the frontend and API use different origins, their credential, CORS, cookie and CSRF settings must be configured together.

## Planned conventions

| Area           | Convention                                                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requests       | JSON bodies with `Content-Type: application/json`, where a body is required.                                                                            |
| Authentication | Server-side sessions using HttpOnly cookies; no bearer-token flow is planned.                                                                           |
| CSRF           | Fetch `data.csrfToken` from `/auth/csrf`; send `X-CSRF-Token` with mutations, including login and activation. See the planned [auth contract](auth.md). |
| Roles          | `student`, `teacher`, `admin`; display `teacher` as Lecturer in the interface.                                                                          |
| Dates          | ISO 8601 timestamps with an explicit timezone, stored and returned in UTC.                                                                              |
| Permissions    | Enforce account status, role, class membership and resource ownership on the server.                                                                    |
| Collections    | Use `data` and pagination `meta`; filter permissions before calculating totals.                                                                         |

Cookie settings and names, exact request schemas, pagination limits and endpoint-specific response fields will be finalised during implementation. Auth and attendance payloads are planned contracts; the shared frontend already expects the core session/CSRF shapes in [auth.md](auth.md#frontend-integration-contract). The separate [sample API reference](examples.md) documents implemented, tested routes and their current errors.

## Planned status codes

| Status | Meaning                                                                        |
| ------ | ------------------------------------------------------------------------------ |
| 200    | Successful read or update.                                                     |
| 201    | Resource created.                                                              |
| 204    | Successful operation with no response body.                                    |
| 400    | Invalid sample-route pagination or ID; implemented examples use Nest defaults. |
| 401    | Authentication missing or invalid.                                             |
| 403    | Access denied.                                                                 |
| 404    | Resource missing or not visible to the requester.                              |
| 409    | Conflict with current resource state.                                          |
| 422    | Invalid request data.                                                          |
| 429    | Request rate limit exceeded.                                                   |

Proposed application error format:

```json
{
  "error": {
    "code": "LOCATION_INACCURATE",
    "message": "Your location is not accurate enough. No attendance was recorded. Please try again.",
    "fields": {}
  }
}
```

This error format is not implemented by the current scaffold. The development sample uses Nest’s default error envelope and `400` for invalid inputs; see [sample errors](examples.md#errors). Feature developers should use the planned contract and coordinate changes with the frontend.

## Updating the reference

For each implemented endpoint, document its method, path, access rules, headers, parameters, request body, success response, error responses and validation rules. Mark it implemented only after verification. Keep examples fictional and omit real passwords, session cookies and invitation tokens.
