import { EnrolmentsModule } from './enrolments/enrolments.module';
import { CoursesModule } from './courses/courses.module';
import { AdminUsersModule } from './users/admin-users.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ExamplesModule } from './examples/examples.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DevAuthModule } from './dev/dev-auth.module';
import { AuthModule } from './auth/auth.module';
import { jwtAuthEnabled } from './auth/auth.config';
import { devAuthEnabled } from './dev/dev-auth';
import { TimetableModule } from './timetable/timetable.module';
import { ClassSessionsModule } from './class-sessions/class-sessions.module';

@Module({
  imports: [
    DatabaseModule,
    AttendanceModule,
    EnrolmentsModule,
    CoursesModule,
    AdminUsersModule,
    AnnouncementsModule,
    TimetableModule,
    ClassSessionsModule,
    ...(jwtAuthEnabled() ? [AuthModule] : []),
    ...(devAuthEnabled() ? [DevAuthModule] : []),
    ...(process.env.NODE_ENV === 'development' ? [ExamplesModule] : []),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
