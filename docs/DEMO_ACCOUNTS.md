# Demo accounts

`npm run stack:up` (or `docker compose up`) loads fictional demo data into an empty database. You do not need to open `database/dummy-data.sql`: everything you need to sign in and look around is on this page. These accounts are for local development only.

## How to sign in

Open http://localhost:5173. How you sign in depends on the auth mode in your `.env`.

### Development sign-in (default)

`DEV_AUTH_ENABLED=true` is the default, so there is no password prompt. Use **Preview as** in the yellow **Development sign-in** toolbar at the top of the page and pick a role:

| Preview as | Signs in as                | Good for checking                                                                |
| ---------- | -------------------------- | -------------------------------------------------------------------------------- |
| Student    | `student.one@example.com`  | Student home, today's classes, check-in, own attendance history (4 classes)      |
| Lecturer   | `lecturer.one@example.com` | Class list, session rosters, attendance records (classes COS30043-A, COS20019-A) |
| Admin      | `admin.demo@example.com`   | Admin features (user list and search, account creation, password reset)          |

The toolbar can only select these three accounts. If it is missing, reload the page. See [development sign-in](DEVELOPMENT_AUTH.md) for details.

### Email and password (JWT mode)

With `JWT_AUTH_ENABLED=true`, `DEV_AUTH_ENABLED=false` and a `JWT_SECRET` (see [JWT authentication](JWT_AUTH.md)), sign in with any account below using the shared password:

```text
opentexila-demo-password
```

The frontend does not use JWT sign-in yet, so in this mode use the API directly (`POST /api/v1/auth/login`). The JWT guide has the full flow.

## Accounts

**Password for every account: `opentexila-demo-password`**

Every account is active and does not have to change its password.

| Role     | Name                    | Email                                                    | Password                   |
| -------- | ----------------------- | -------------------------------------------------------- | -------------------------- |
| Admin    | Admin Demo              | `admin.demo@example.com`                                 | `opentexila-demo-password` |
| Lecturer | Lecturer One to Four    | `lecturer.one@example.com` … `lecturer.four@example.com` | `opentexila-demo-password` |
| Student  | Student One to Twenty   | `student.one@example.com` … `student.twenty@example.com` | `opentexila-demo-password` |
| Student  | Non Member (no classes) | `nonmember.demo@example.com`                             | `opentexila-demo-password` |

The number words are spelled out in the email: `student.one`, `student.two`, … `student.nineteen`, `student.twenty`.

## Who teaches and who is enrolled

All classes are in term `2026-S2`. Each has weekly sessions: five past weeks with attendance, one today, two upcoming, and a cancelled session in some classes.

| Class (id)     | Course                           | Lecturer       | Students                                           | Starts (UTC) |
| -------------- | -------------------------------- | -------------- | -------------------------------------------------- | ------------ |
| COS30043-A (1) | Interface Design and Development | Lecturer One   | Student One to Eight                               | 01:00        |
| COS30043-B (2) | Interface Design and Development | Lecturer Two   | Student Nine to Fourteen                           | 04:00        |
| COS20007-A (3) | Object Oriented Programming      | Lecturer Two   | Student One, Two, Three, Four, Fifteen, Sixteen    | 07:00        |
| COS20007-B (4) | Object Oriented Programming      | Lecturer Three | Student Five to Ten                                | 10:00        |
| COS10009-A (5) | Introduction to Programming      | Lecturer Three | Student Eleven to Eighteen                         | 01:00        |
| COS10009-B (6) | Introduction to Programming      | Lecturer Four  | Student One, Seventeen, Eighteen, Nineteen, Twenty | 04:00        |
| COS20031-A (7) | Database Design and Development  | Lecturer Four  | Student One, Two, Five, Six, Nineteen, Twenty      | 07:00        |
| COS20019-A (8) | Cloud Computing Architecture     | Lecturer One   | Student Three to Ten                               | 10:00        |

`student.one@example.com` is in classes 1, 3, 6 and 7, so it has the most to look at. `nonmember.demo@example.com` is enrolled nowhere, which is useful for checking "not enrolled" errors.

## Trying check-in

- A session lasts two hours from its start time. Check-ins in the first 15 minutes are on time; later ones are late.
- Today's sessions start at the UTC times in the table, so some are usually in the past or the future when you test.
- The demo venues are at coordinates `0, 0` with a 100 m radius, so a real device's location will be rejected. Use browser location emulation set to `0, 0`.
- If no session is open, run `npm run db:seed:attendance` on the host to add two fresh sessions (see [development sign-in](DEVELOPMENT_AUTH.md#fresh-check-in-sessions)).

## Resetting the data

Data is loaded only when the `users` table is empty. To start again from the original dummy data, delete the Compose volume (this erases the whole local database, including anything you added):

```sh
docker compose down -v
npm run stack:up
```

Set `SEED_DEMO_DATA=false` in `.env` to start with an empty database instead.
