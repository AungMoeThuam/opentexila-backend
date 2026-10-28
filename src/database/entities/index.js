import { CourseSchema } from './course.schema';
import { UserSchema } from './user.schema';
import { InvitationSchema } from './invitation.schema';
import { ClassroomSchema } from './classroom.schema';
import { EnrolmentSchema } from './enrolment.schema';
import { MeetingSchema } from './meeting.schema';
import { AttendanceSessionSchema } from './attendance-session.schema';
import { AttendanceRecordSchema } from './attendance-record.schema';

export {
  CourseSchema,
  UserSchema,
  InvitationSchema,
  ClassroomSchema,
  EnrolmentSchema,
  MeetingSchema,
  AttendanceSessionSchema,
  AttendanceRecordSchema,
};
export const entities = [
  CourseSchema,
  UserSchema,
  InvitationSchema,
  ClassroomSchema,
  EnrolmentSchema,
  MeetingSchema,
  AttendanceSessionSchema,
  AttendanceRecordSchema,
];
