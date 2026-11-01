import { Course, CourseSchema, CourseEntity } from './course.schema';
import {
  User,
  UserSchema,
  UserEntity,
  UserRole,
  UserStatus,
} from './user.schema';
import { Class, ClassSchema, ClassEntity } from './class.schema';
import {
  Enrolment,
  EnrolmentSchema,
  EnrolmentEntity,
} from './enrolment.schema';
import {
  ClassSession,
  ClassSessionSchema,
  ClassSessionEntity,
  ClassSessionState,
} from './class-session.schema';
import {
  AttendanceRecord,
  AttendanceRecordSchema,
  AttendanceRecordEntity,
  AttendanceStatus,
} from './attendance-record.schema';

export {
  Course,
  CourseSchema,
  CourseEntity,
  User,
  UserSchema,
  UserEntity,
  UserRole,
  UserStatus,
  Class,
  ClassSchema,
  ClassEntity,
  Enrolment,
  EnrolmentSchema,
  EnrolmentEntity,
  ClassSession,
  ClassSessionSchema,
  ClassSessionEntity,
  ClassSessionState,
  AttendanceRecord,
  AttendanceRecordSchema,
  AttendanceRecordEntity,
  AttendanceStatus,
};

export const entities = [
  Course,
  User,
  Class,
  Enrolment,
  ClassSession,
  AttendanceRecord,
];
