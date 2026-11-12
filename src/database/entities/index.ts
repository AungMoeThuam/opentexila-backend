import { RefreshSession } from './refresh-session.schema';
import {
  Announcement,
  AnnouncementSchema,
  AnnouncementEntity,
  AnnouncementCategory,
  ANNOUNCEMENT_CATEGORIES,
} from './announcement.schema';
import { AnnouncementLike } from './announcement-like.schema';
import { AnnouncementComment } from './announcement-comment.schema';
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
  RefreshSession,
  Announcement,
  AnnouncementSchema,
  AnnouncementEntity,
  AnnouncementCategory,
  ANNOUNCEMENT_CATEGORIES,
  AnnouncementLike,
  AnnouncementComment,
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
  RefreshSession,
  Announcement,
  AnnouncementLike,
  AnnouncementComment,
  Course,
  User,
  Class,
  Enrolment,
  ClassSession,
  AttendanceRecord,
];
