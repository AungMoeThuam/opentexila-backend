# Hosted demo: accounts and data

This page is for the hosted demo (the "production" seed). It has the accounts you can sign in with, the data you will see, and how to run a live check-in demo. The data is fictional. For local development, see [Demo accounts](DEMO_ACCOUNTS.md).

## How to sign in

Every account uses the same password:

```text
opentexila-demo-password
```

(You can set another password with `SEED_PASSWORD` when you load the seed. It must have 12 characters or more.)

No account must change its password at first sign-in.

| Role     | Name                           | Email                                                     |
| -------- | ------------------------------ | --------------------------------------------------------- |
| Admin    | Admin                          | `admin@example.com`                                       |
| Lecturer | Lecturer One to Lecturer Eight | `lecturer-one@example.com` … `lecturer-eight@example.com` |
| Student  | Student One to Student Fifty   | `student-one@example.com` … `student-fifty@example.com`   |

The number is spelled out in the email: `student-twenty-one@example.com`, `student-fifty@example.com`.

## What the data looks like

| Data               | Amount                                                                     |
| ------------------ | -------------------------------------------------------------------------- |
| Admin              | 1                                                                          |
| Lecturers          | 8 (each teaches 3 classes; Lecturer One also teaches the live demo class)  |
| Students           | 50 (each is in 3 or 4 classes)                                             |
| Classes            | 25: 24 normal classes and 1 live demo class                                |
| Terms              | `2026-S2` (21 normal classes and the live class) and `2027-S1` (3 classes) |
| Sessions           | 339: weekly sessions from 8 weeks ago to 4 weeks ahead                     |
| Attendance records | about 2,500 (about 1,700 of them are for sessions that already ended)      |
| Announcements      | 30                                                                         |

Every list has 2 or 3 pages (20 rows per page): for example the admin classes list (25 rows), the admin user list (59 rows), a lecturer's attendance sessions, and a student's attendance history. The seed checks this before it writes anything.

Two classes meet twice a week, and three classes have about 28 students, so you can see long rosters and long session lists.

## Live check-in demo

The normal classes use a real campus location. A person who is not on the campus cannot check in to them. For a live demo, use the class **DEMO101-A, Live Check-in Demo**:

- Its room is "Anywhere (live demo)". The check-in area is so large that every place on Earth is inside it. The student's browser must still allow location access.
- It has one session that is open now and stays open for 75 days. A check-in before the late time is **Present**.
- Students One to Ten are enrolled. Lecturer One teaches it.

Steps for the demo:

1. Sign in as `student-one@example.com`, open **Today's classes** (or Scheduled classes) and open the DEMO101-A session. Select **Check in** and allow location.
2. In another browser, sign in as `lecturer-one@example.com` and open the attendance records of DEMO101-A. The record changes from Pending to Present.
3. To run the demo again, reset it (below).

The page must use HTTPS, or location access is blocked by the browser.

### Reset the live demo

This sets Students One to Ten back to Pending and opens the session again for 75 days from now. It changes nothing else.

```bash
npm run demo:live-reset
```

On the hosted server, run it in the API container, for example `docker compose exec api npm run demo:live-reset` (adjust to your setup).

Notes:

- Do not edit the live demo class in the admin pages. The pages limit the check-in area to 1,000 m, so a save would fail.
- To show **Late**, sign in as the admin and add a new session to DEMO101-A that started 20 minutes ago with a late allowance of 15 minutes. A check-in to that session is Late.

## Load the seed

The seed only runs on an **empty** database (after the migrations). It stops if any user exists.

```bash
npm run db:migrate
npm run db:seed:production
```

To see the counts and the page check without a database:

```bash
node --experimental-strip-types --no-warnings database/seeds/production.ts --dry-run
```

Optional setting: `SEED_PASSWORD` (12 characters or more). Without it, the password above is used.

The times are relative to the day you run the seed, so run it when you deploy. Sessions that end later become "absent" for students who did not check in, in the normal way.
