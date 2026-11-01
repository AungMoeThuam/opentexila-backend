# Classes API (Demo & Production)

[API overview](README.md) · [Database design](../database-design.md)

**Status: Implemented with demo fallback and live database support.**

Provides endpoints to list classes, view class details, and retrieve scheduled timetable meetings. Supports both real MySQL database records and rich demo fixtures when operating in development or testing without a live database.

## Base Paths

The controller accepts any of the following route prefixes under `/api/v1`:
- `/classes` (standard REST endpoint)
- `/demo/classes` (explicit demo endpoint)
- `/classrooms` (schema entity alias)
- `/demo/classrooms`

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/classes` | List non-archived classes with pagination and search. |
| `GET` | `/classes/:id` | Get details for a single class by positive integer ID. |
| `GET` | `/classes/:id/class-meetings` | Get scheduled timetable meetings for a class. |
| `GET` | `/demo/classes` | Explicit demo list endpoint. |
| `GET` | `/demo/classes/:id` | Explicit demo detail endpoint. |

## GET /classes

Returns a paginated list of non-archived classes in ascending ID order.

### Query Parameters

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `page` | integer | `1` | Page number (1 to 10000). |
| `limit` | integer | `20` | Items per page (1 to 100). |
| `search` / `q` | string | optional | Case-insensitive search on code, name, subject, or room. |
| `term` | string | optional | Filter by exact term (e.g. `DEMO`). |
| `teacher_id` | integer | optional | Filter by assigned teacher user ID. |
| `demo` | boolean | `false` | When `true`, forces demo fixtures even if database is connected. |

### Example Request

```sh
curl 'http://127.0.0.1:3000/api/v1/classes?page=1&limit=20'
curl 'http://127.0.0.1:3000/api/v1/classes?search=interface'
curl 'http://127.0.0.1:3000/api/v1/demo/classes'
```

### Example Response (`200 OK`)

```json
{
  "data": [
    {
      "id": 1,
      "code": "COS30043-DEMO",
      "name": "Interface Design · Demo",
      "subject": "Interface Design and Development",
      "term": "DEMO",
      "room_label": "Demo room (synthetic location)",
      "teacher_id": 2,
      "teacher": {
        "id": 2,
        "name": "Lecturer Demo",
        "email": "lecturer@demo.opentexila.local",
        "role": "teacher"
      },
      "latitude": "0.000000",
      "longitude": "0.000000",
      "radius_m": "100.00",
      "max_accuracy_m": "30.00",
      "schedule": "Mon, Wed 09:00 - 11:00 UTC",
      "enrolled_count": 24,
      "created_at": "2026-10-27T01:00:00.000Z",
      "updated_at": "2026-10-27T01:00:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 4,
    "totalPages": 1
  }
}
```

## GET /classes/:id

Retrieves full details for a single class.

### Parameters

- `id`: Positive integer between 1 and 4294967295.

### Example Request

```sh
curl 'http://127.0.0.1:3000/api/v1/classes/1'
```

### Example Response (`200 OK`)

```json
{
  "data": {
    "id": 1,
    "code": "COS30043-DEMO",
    "name": "Interface Design · Demo",
    "subject": "Interface Design and Development",
    "term": "DEMO",
    "room_label": "Demo room (synthetic location)",
    "teacher_id": 2,
    "teacher": {
      "id": 2,
      "name": "Lecturer Demo",
      "email": "lecturer@demo.opentexila.local",
      "role": "teacher"
    },
    "latitude": "0.000000",
    "longitude": "0.000000",
    "radius_m": "100.00",
    "max_accuracy_m": "30.00",
    "schedule": "Mon, Wed 09:00 - 11:00 UTC",
    "enrolled_count": 24,
    "created_at": "2026-10-27T01:00:00.000Z",
    "updated_at": "2026-10-27T01:00:00.000Z"
  }
}
```

## GET /classes/:id/class-meetings

Returns scheduled timetable occurrences for the class.

### Example Request

```sh
curl 'http://127.0.0.1:3000/api/v1/classes/1/class-meetings'
```

### Example Response (`200 OK`)

```json
{
  "data": [
    {
      "id": 1,
      "classroom_id": 1,
      "starts_at": "2026-10-27T01:00:00.000Z",
      "late_after": "2026-10-27T01:15:00.000Z",
      "ends_at": "2026-10-27T03:00:00.000Z",
      "state": "scheduled",
      "session_state": "closed"
    },
    {
      "id": 2,
      "classroom_id": 1,
      "starts_at": "2026-10-28T01:00:00.000Z",
      "late_after": "2026-10-28T01:15:00.000Z",
      "ends_at": "2026-10-28T03:00:00.000Z",
      "state": "scheduled",
      "session_state": "open"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 2,
    "totalPages": 1
  }
}
```

## Error Handling

| Status | Condition | Example Response |
| --- | --- | --- |
| `400 Bad Request` | Invalid `page`, `limit`, or `id` format | `{"message": "limit must be an integer between 1 and 100.", "error": "Bad Request", "statusCode": 400}` |
| `404 Not Found` | Class not found or archived | `{"message": "Class not found.", "error": "Not Found", "statusCode": 404}` |
