# Class Announcements API

[API overview](README.md) · [Authentication](auth.md) · [Classes and enrolments](enrolments.md)

**Status: reading announcements (list for all classes, list for one class, and get one) is implemented. Creating, editing and deleting posts, likes and comments are planned in the next backend issues.** Paths are relative to `/api/v1`.

A lecturer posts news to one of their classes, for example a class change or a reminder. Students of that class read the posts, like them and write comments. Pinned posts are not planned.

## Endpoint summary

| Method | Path | Allowed roles | Status |
| --- | --- | --- | --- |
| GET | `/announcements` | Lecturer (own classes), student (enrolled classes), admin (all) | Implemented |
| GET | `/classes/:classId/announcements` | Assigned lecturer, enrolled student, admin | Implemented |
| GET | `/announcements/:announcementId` | Assigned lecturer, enrolled student, admin | Implemented |
| POST | `/classes/:classId/announcements` | Assigned lecturer | Planned (write API) |
| PATCH | `/announcements/:announcementId` | Author | Planned (write API) |
| DELETE | `/announcements/:announcementId` | Author, admin | Planned (write API) |
| PUT, DELETE | `/announcements/:announcementId/like` | Assigned lecturer, enrolled student | Planned (likes and comments API) |
| GET, POST | `/announcements/:announcementId/comments` | Assigned lecturer, enrolled student (GET also admin) | Planned (likes and comments API) |
| DELETE | `/comments/:commentId` | Author, class lecturer, admin | Planned (likes and comments API) |

## Who can see what

| Action | Lecturer of the class | Enrolled student | Admin | Other users |
| --- | --- | --- | --- | --- |
| Read announcements and comments | Yes | Yes | Yes | No |
| Create an announcement | Yes | No | No | No |
| Edit an announcement | Own posts only | No | No | No |
| Delete an announcement | Own posts only | No | Any | No |
| Like or unlike | Yes | Yes | No | No |
| Write a comment | Yes | Yes | No | No |
| Delete a comment | Any comment on own class | Own comments only | Any | No |

The rules are checked on the server. A class or post that the caller may not see returns `404 RESOURCE_NOT_FOUND`, the same answer as for a missing one, so the API does not show which classes exist. Every endpoint needs a signed-in user and uses the same guard as the other features. Responses use `Cache-Control: no-store`.

## Data

Migration `1793750400000-Announcements.ts` creates three tables. IDs are unsigned integers and dates are UTC `DATETIME(3)`.

| Table | Columns |
| --- | --- |
| `announcements` | `id`, `class_id` (FK `classes`), `author_id` (FK `users`), `category` (`general`, `class_change`, `reminder`, `exam`), `title` (1–150), `body` (1–5000), `created_at`, `updated_at` |
| `announcement_likes` | `announcement_id` (FK, delete cascade), `user_id` (FK), `created_at`. Primary key (`announcement_id`, `user_id`): one like for each user and post. |
| `announcement_comments` | `id`, `announcement_id` (FK, delete cascade), `author_id` (FK `users`), `body` (1–1000), `created_at` |

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

| Query | Rule | Default |
| --- | --- | --- |
| `classId` | Integer, 1–4294967295. Narrows the list to one class. A class the caller may not see, or that does not exist, returns `404`. | all visible classes |
| `search` | 1–100 characters after trimming. Case-insensitive match on `title` or `body`. `%` and `_` match literally. | none |
| `category` | `general`, `class_change`, `reminder` or `exam` | all |
| `sort` | `newest`, `oldest` or `most_liked` | `newest` |
| `page` | Integer, 1–10000 | `1` |
| `limit` | Integer, 1–100 | `20` |

Sorting, search and paging work as in the per-class list below. Success: **200 OK**

```json
{
  "data": [ { "...": "announcement object, with its class" } ],
  "meta": { "page": 1, "limit": 20, "total": 24, "totalPages": 2 }
}
```

There is no `context` here, because the posts come from several classes. Use each post's `class` instead. No match returns `"data": []`.

### `GET /classes/:classId/announcements`

| Query | Rule | Default |
| --- | --- | --- |
| `search` | 1–100 characters after trimming. Case-insensitive match on `title` or `body`. `%` and `_` match literally. | none |
| `category` | `general`, `class_change`, `reminder` or `exam` | all |
| `sort` | `newest`, `oldest` or `most_liked` | `newest` |
| `page` | Integer, 1–10000 | `1` |
| `limit` | Integer, 1–100 | `20` |

Sort order: `newest` is `created_at` new to old; `oldest` is old to new; `most_liked` is `like_count` high to low, then `created_at` new to old. Every sort ends with `id`, so pages stay stable.

Success: **200 OK**

```json
{
  "data": [ { "...": "announcement object" } ],
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

## Errors

Errors use the shared envelope:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": { "limit": "..." } } }
```

| HTTP | Code | When |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | No valid sign-in |
| 403 | `PASSWORD_CHANGE_REQUIRED` | The user must change the password first |
| 404 | `RESOURCE_NOT_FOUND` | The class or post does not exist, or the user may not see it |
| 422 | `VALIDATION_ERROR` | An ID or query value is not valid. `fields` names each one. |
