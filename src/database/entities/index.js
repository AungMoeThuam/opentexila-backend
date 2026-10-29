import { CourseSchema } from './course.schema';
import { UserSchema } from './user.schema';
import { ClassSchema } from './class.schema';
import { EnrolmentSchema } from './enrolment.schema';
import { ClassSessionSchema } from './class-session.schema';
import { AttendanceRecordSchema } from './attendance-record.schema';

export {
  CourseSchema,
  UserSchema,
  ClassSchema,
  EnrolmentSchema,
  ClassSessionSchema,
  AttendanceRecordSchema,
};
export const entities = [
  CourseSchema,
  UserSchema,
  ClassSchema,
  EnrolmentSchema,
  ClassSessionSchema,
  AttendanceRecordSchema,
];
