# Class Announcements API

[API overview](README.md) · [Authentication](auth.md) · [Classes and enrolments](enrolments.md)

**Status: reading announcements (list for all classes, list for one class, and get one) writing them (create, edit, delete), likes and comments are implemented.** Paths are relative to `/api/v1`.

A lecturer posts news to one of their classes, for example a class change or a reminder. Students of that class read the posts, like them and write comments. Pinned posts are not planned.

## Endpoint summary

| Method      | Path                                      | Allowed roles                                                   | Status      |
| ----------- | ----------------------------------------- | --------------------------------------------------------------- | ----------- |
| GET         | `/announcements`                          | Lecturer (own classes), student (enrolled classes), admin (all) | Implemented |
| GET         | `/classes/:classId/announcements`         | Assigned lecturer, enrolled student, admin                      | Implemented |
| GET         | `/announcements/:announcementId`          | Assigned lecturer, enrolled student, admin                      | Implemented |
| POST        | `/classes/:classId/announcements`         | Assigned lecturer                                               | Implemented |
| PATCH       | `/announcements/:announcementId`          | Author (the assigned lecturer)                                  | Implemented |
| DELETE      | `/announcements/:announcementId`          | Author (the assigned lecturer), admin                           | Implemented |
| PUT, DELETE | `/announcements/:announcementId/like`     | Assigned lecturer, enrolled student                             | Implemented |
| GET, POST   | `/announcements/:announcementId/comments` | Assigned lecturer, enrolled student (GET also admin)            | Implemented |
| DELETE      | `/comments/:commentId`                    | Author, class lecturer, admin                                   | Implemented |

## Who can see what

| Action                          | Lecturer of the class    | Enrolled student  | Admin | Other users |
| ------------------------------- | ------------------------ | ----------------- | ----- | ----------- |
| Read announcements and comments | Yes                      | Yes               | Yes   | No          |
| Create an announcement          | Yes                      | No                | No    | No          |
| Edit an announcement            | Own posts only           | No                | No    | No          |
| Delete an announcement          | Own posts only           | No                | Any   | No          |
| Like or unlike                  | Yes                      | Yes               | No    | No          |
| Write a comment                 | Yes                      | Yes               | No    | No          |
| Delete a comment                | Any comment on own class | Own comments only | Any   | No          |

The rules are checked on the server. A class or post that the caller may not see returns `404 RESOURCE_NOT_FOUND`, the same answer as for a missing one, so the API does not show which classes exist. Every endpoint needs a signed-in user and uses the same guard as the other features. Responses use `Cache-Control: no-store`.

## Data

Migration `1793750400000-Announcements.ts` creates three tables. IDs are unsigned integers and dates are UTC `DATETIME(3)`.

| Table                   | Columns                                                                                                                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `announcements`         | `id`, `class_id` (FK `classes`), `author_id` (FK `users`), `category` (`general`, `class_change`, `reminder`, `exam`), `title` (1–150), `body` (1–5000), `created_at`, `updated_at` |
| `announcement_likes`    | `announcement_id` (FK, delete cascade), `user_id` (FK), `created_at`. Primary key (`announcement_id`, `user_id`): one like for each user and post.                                  |
| `announcement_comments` | `id`, `announcement_id` (FK, delete cascade), `author_id` (FK `users`), `body` (1–1000), `created_at`                                                                               |

## The announcement object

```json
{
  "id": 41,
  "class_id": 7,
  "category": "class_change",
  "title": "Tomorrow's class moves to EN305",
  "body": "Please go to room EN305 at the usual time.",
  "author": { "id": 2, "name": "Lecturer One" },
  "class": {
    "id": 7,
    "course": { "id": 1, "code": "COS30043", "name": "Interface Design" },
    "section": "A",
    "term": "2026-S2"
  },
  "created_at": "2026-11-12T01:00:00.000Z",
  "updated_at": "2026-11-12T01:00:00.000Z",
  "like_count": 12,
  "comment_count": 3,
  "liked_by_me": true
}
```

`class` names the class the post belongs to, so a list across several classes can label each post. `like_count`, `comment_count` and `liked_by_me` come from the like and comment tables in the same query, so one page needs one query, not one for each post. `liked_by_me` is always `false` for an admin. Show `title`, `body` and comments as plain text.

### `GET /announcements`

One list of announcements from **all** the classes the caller may see: the enrolled classes of a student, the taught classes of a lecturer, every class for an admin. It powers the "Announcements" page in the navigation.

| Query      | Rule                                                                                                                         | Default             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `classId`  | Integer, 1–4294967295. Narrows the list to one class. A class the caller may not see, or that does not exist, returns `404`. | all visible classes |
| `search`   | 1–100 characters after trimming. Case-insensitive match on `title` or `body`. `%` and `_` match literally.                   | none                |
| `category` | `general`, `class_change`, `reminder` or `exam`                                                                              | all                 |
| `sort`     | `newest`, `oldest` or `most_liked`                                                                                           | `newest`            |
| `page`     | Integer, 1–10000                                                                                                             | `1`                 |
| `limit`    | Integer, 1–100                                                                                                               | `20`                |

Sorting, search and paging work as in the per-class list below. Success: **200 OK**

```json
{
  "data": [{ "...": "announcement object, with its class" }],
  "meta": { "page": 1, "limit": 20, "total": 24, "totalPages": 2 }
}
```

There is no `context` here, because the posts come from several classes. Use each post's `class` instead. No match returns `"data": []`.

### `GET /classes/:classId/announcements`

| Query      | Rule                                                                                                       | Default  |
| ---------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| `search`   | 1–100 characters after trimming. Case-insensitive match on `title` or `body`. `%` and `_` match literally. | none     |
| `category` | `general`, `class_change`, `reminder` or `exam`                                                            | all      |
| `sort`     | `newest`, `oldest` or `most_liked`                                                                         | `newest` |
| `page`     | Integer, 1–10000                                                                                           | `1`      |
| `limit`    | Integer, 1–100                                                                                             | `20`     |

Sort order: `newest` is `created_at` new to old; `oldest` is old to new; `most_liked` is `like_count` high to low, then `created_at` new to old. Every sort ends with `id`, so pages stay stable.

Success: **200 OK**

```json
{
  "data": [{ "...": "announcement object" }],
  "context": {
    "class": {
      "id": 7,
      "course": { "id": 1, "code": "COS30043", "name": "Interface Design" },
      "section": "A",
      "term": "2026-S2",
      "lecturer": { "id": 2, "name": "Lecturer One" },
      "room_label": "EN402"
    }
  },
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

`context.class` is the same class summary as the roster endpoint. A page can show which class the feed belongs to without another request. No match returns `"data": []` with `"total": 0`. It is not an error.

### `GET /announcements/:announcementId`

Success: **200 OK** with `{ "data": { announcement object } }`.

### `POST /classes/:classId/announcements`

Only the lecturer assigned to the class may call it. The author is always the signed-in user.

```json
{
  "category": "class_change",
  "title": "Tomorrow's class moves to EN305",
  "body": "Please go to room EN305."
}
```

| Field      | Rule                                                                            |
| ---------- | ------------------------------------------------------------------------------- |
| `category` | Optional. `general`, `class_change`, `reminder` or `exam`. Default `general`.   |
| `title`    | 1–150 characters after trimming                                                 |
| `body`     | 1–5000 characters after trimming. Plain text; the server does not interpret it. |

Unknown fields are stripped. The caller cannot set `author_id`, `class_id`, `created_at`, `updated_at` or the counts. Success: **201 Created** with `{ "data": { announcement object } }`. `like_count` and `comment_count` are `0` and `liked_by_me` is `false`.

### `PATCH /announcements/:announcementId`

Only the author may edit, and the author must still be the lecturer assigned to the class. Send at least one of `category`, `title`, `body`, with the same rules as create. The server sets `updated_at` and never changes `created_at`, the class or the author. A body with none of the three fields returns `422` with the message under `fields.body`.

Success: **200 OK** with `{ "data": { announcement object } }`.

### `DELETE /announcements/:announcementId`

The author, or any admin, may delete. The database deletes the post's likes and comments with it. Success: **204 No Content** with no body.

### `PUT /announcements/:announcementId/like` and `DELETE /announcements/:announcementId/like`

No request body. Only the lecturer of the class and enrolled students may like; an admin gets `403 FORBIDDEN`. Both calls are safe to repeat: a second `PUT` does not add a second like, and a second `DELETE` is not an error. The server changes the like and counts the likes in one transaction.

Success: **200 OK**

```json
{ "data": { "liked": true, "like_count": 13 } }
```

`DELETE` returns `"liked": false` with the new count.

### `GET /announcements/:announcementId/comments`

The lecturer of the class, enrolled students and admins may read.

| Query   | Rule             | Default |
| ------- | ---------------- | ------- |
| `page`  | Integer, 1–10000 | `1`     |
| `limit` | Integer, 1–100   | `20`    |

Comments are sorted from old to new (`created_at`, then `id`). Success: **200 OK**

```json
{
  "data": [
    {
      "id": 90,
      "body": "Thank you, see you there.",
      "author": { "id": 21, "name": "Student Two", "role": "student" },
      "created_at": "2026-11-12T02:00:00.000Z",
      "can_delete": true
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

`can_delete` is `true` for the author of the comment, the lecturer of the class and any admin. The server checks the rule again on delete. No comments returns `"data": []` with `"total": 0`.

### `POST /announcements/:announcementId/comments`

```json
{ "body": "Thank you, see you there." }
```

`body` is 1–1000 characters after trimming, plain text. Unknown fields are stripped. Only the lecturer of the class and enrolled students may write; an admin gets `403 FORBIDDEN`. Success: **201 Created** with `{ "data": { comment object } }`.

### `DELETE /comments/:commentId`

Allowed for the author of the comment, the lecturer of the class and any admin. Success: **204 No Content** with no body. A student cannot delete the comment of another student (`403`). A lecturer of another class and a student who is not enrolled get `404`.

## Errors

Errors use the shared envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "fields": { "limit": "..." }
  }
}
```

| HTTP | Code                       | When                                                                                                                                                                                                                                                                                                       |
| ---- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 401  | `UNAUTHENTICATED`          | No valid sign-in                                                                                                                                                                                                                                                                                           |
| 403  | `FORBIDDEN`                | The role cannot do this (a student or admin creates or edits; a student deletes), a lecturer edits or deletes a post of another author in a class they can see, an admin likes or comments, or a user deletes a comment they may not delete (for example a student deletes the comment of another student) |
| 403  | `PASSWORD_CHANGE_REQUIRED` | The user must change the password first                                                                                                                                                                                                                                                                    |
| 404  | `RESOURCE_NOT_FOUND`       | The class or post does not exist, or the user may not see it. This includes a lecturer who writes to a class of another lecturer and a student who is not enrolled.                                                                                                                                        |
| 422  | `VALIDATION_ERROR`         | An ID, query value or body field is not valid. `fields` names each one.                                                                                                                                                                                                                                    |
