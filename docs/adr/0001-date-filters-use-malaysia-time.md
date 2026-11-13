# Date filters use Malaysia time (UTC+8)

Date-only filters (`from`, `to`) and day groupings mean a Malaysia day, a fixed `+08:00` offset (Malaysia has no daylight saving). This covers attendance analytics and the timetable (`GET /class-sessions`). The rest of the API uses UTC timestamps (`docs/api/README.md`), but a Lecturer reading "6 October" means the Malaysian day, and a 7 a.m. class would otherwise land on the previous UTC day. The offset lives in one named constant. Revisit if the product ever serves another timezone.

Which sessions fall on a day differs by feature, on purpose:

- **Attendance analytics** counts a Class session once, on the Malaysia day it starts.
- **Timetable** is a calendar view, so it lists every Class session that overlaps the range. A session that starts at 23:59 appears on that day, and one that runs past midnight appears on both days.

Date-only parameters must be real dates in years 1000–9998 (the MySQL `DATETIME` range, leaving room for the one-day and eight-hour shifts); anything else is a 422 on that field.
