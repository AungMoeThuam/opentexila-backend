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
