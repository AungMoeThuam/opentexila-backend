import { CourseSchema, CourseEntity } from './course.schema';
import { UserSchema, UserEntity, UserRole, UserStatus } from './user.schema';
import { ClassSchema, ClassEntity } from './class.schema';
import { EnrolmentSchema, EnrolmentEntity } from './enrolment.schema';
import {
  ClassSessionSchema,
  ClassSessionEntity,
  ClassSessionState,
} from './class-session.schema';
import {
  AttendanceRecordSchema,
  AttendanceRecordEntity,
  AttendanceStatus,
} from './attendance-record.schema';

export {
  CourseSchema,
  CourseEntity,
  UserSchema,
  UserEntity,
  UserRole,
  UserStatus,
  ClassSchema,
  ClassEntity,
  EnrolmentSchema,
  EnrolmentEntity,
  ClassSessionSchema,
  ClassSessionEntity,
  ClassSessionState,
  AttendanceRecordSchema,
  AttendanceRecordEntity,
  AttendanceStatus,
};

export const entities = [
  CourseSchema,
  UserSchema,
  ClassSchema,
  EnrolmentSchema,
  ClassSessionSchema,
  AttendanceRecordSchema,
];
