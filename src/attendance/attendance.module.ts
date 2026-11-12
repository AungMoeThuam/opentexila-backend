import { AuthModule } from '../auth/auth.module';
import { jwtAuthEnabled } from '../auth/auth.config';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceGuard } from './attendance.guard';
import { AttendanceExceptionFilter } from './attendance.filter';
import { RosterService } from './roster.service';
import { AttendanceRecordsController } from './me-attendance-records.controller';
import { AttendanceHistoryService } from './attendance-history.service';
import { ClassSessionRecordsController } from './class-session-records.controller';
import { ClassSessionRecordsService } from './class-session-records.service';
import { ClassSessionFinaliseController } from './class-session-finalise.controller';
import { FinalisationService } from './finalisation.service';
import { LecturerAttendanceAnalyticsController } from './lecturer-attendance-analytics.controller';
import { AttendanceAnalyticsService } from './attendance-analytics.service';

// In JWT mode AttendanceGuard needs JwtAuthGuard. Nest builds a guard in the
// module that uses it, so every module with a route guarded by AttendanceGuard
// must be able to see JwtAuthGuard. Those modules import AttendanceModule, so it
// re-exports AuthModule. Without that, JwtAuthGuard is missing there and the
// guard answers 503 AUTH_UNAVAILABLE.
const authModules = jwtAuthEnabled() ? [AuthModule] : [];

@Module({
  imports: authModules,
  controllers: [
    AttendanceController,
    AttendanceRecordsController,
    ClassSessionRecordsController,
    ClassSessionFinaliseController,
    LecturerAttendanceAnalyticsController,
  ],
  providers: [
    AttendanceService,
    AttendanceHistoryService,
    AttendanceGuard,
    RosterService,
    ClassSessionRecordsService,
    FinalisationService,
    AttendanceAnalyticsService,
    { provide: APP_FILTER, useClass: AttendanceExceptionFilter },
  ],
  exports: [
    AttendanceService,
    AttendanceHistoryService,
    RosterService,
    AttendanceGuard,
    ...authModules,
  ],
})
export class AttendanceModule {}
