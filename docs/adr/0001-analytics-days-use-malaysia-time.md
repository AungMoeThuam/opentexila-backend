# Attendance analytics days use Malaysia time (UTC+8)

Attendance analytics filters (`from`, `to`) and groups the trend by the calendar day of a Class session's start in Malaysia time, a fixed `+08:00` offset (Malaysia has no daylight saving). The rest of the API uses UTC timestamps (`docs/api/README.md`), but a Lecturer reading "6 October" means the Malaysian day, and a 7 a.m. class would otherwise land on the previous UTC day. The offset lives in one named constant. Revisit if the product ever serves another timezone.
