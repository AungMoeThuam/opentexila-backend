# Glossary

**Course**:
Shared identity of a subject (code and name), independent of when or where it is taught.
_Avoid_: class, subject

**Class**:
One offering of a Course in a specific term and section, taught by one Lecturer.
_Avoid_: course, section (a section is only part of a Class's identity)

**Lecturer**:
A user who teaches a Class. Appears as role `lecturer` in the API.
_Avoid_: teacher, instructor

**Enrolment**:
A student's current membership in a Class.
_Avoid_: registration, signup

**Roster**:
The list of Enrolments for a Class, presented with the Class's context.
_Avoid_: student list, class list

**Class session**:
One scheduled meeting of a Class.
_Avoid_: lesson, occurrence

**Attendance record**:
A student's attendance outcome for one Class session. It outlives the student's Enrolment in the Class.
_Avoid_: check-in (a check-in is only how a record becomes present or late)

**Pending**:
An Attendance record that has not yet been given an outcome by a check-in or by Finalisation.

**Absent**:
The outcome for a student who did not check in before the Class session ended, recorded at Finalisation.

**Finalisation**:
The Lecturer closing a Class session after it has ended, which gives every enrolled student a final Attendance record outcome.
_Avoid_: close, end session (a Class session ends by time but is only finalised by its Lecturer)

**Attendance history**:
A student's Attendance records across all their Classes, current or former.
_Avoid_: attendance log

**Ended class session**:
A Class session that is not cancelled and whose end time has passed.
_Avoid_: finished session, past session

**Finalised class session**:
An Ended class session in which no enrolled student's Attendance record is still pending. Only Finalised class sessions count toward Attendance analytics.
_Avoid_: closed session, completed session

**Attendance rate**:
The share of a student's, Class's or Lecturer's counted Attendance records that are present or late. Late counts as attended.
_Avoid_: attendance percentage, turnout

**At-risk threshold**:
The Attendance rate below which a student is flagged, chosen by the Lecturer. Defaults to 75%.
_Avoid_: cut-off, minimum

**At-risk student**:
A currently enrolled student whose Attendance rate in one Class is below the At-risk threshold. Judged per Class, so one student can be at risk in two Classes.
_Avoid_: failing student, low attendance student

**Malaysia day**:
A calendar day in Malaysia time (UTC+8). Every date-only filter and grouping in the API means a Malaysia day, never a UTC day.
_Avoid_: local day, UTC day
