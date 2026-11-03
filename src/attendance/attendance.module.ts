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

@Module({
  imports: jwtAuthEnabled() ? [AuthModule] : [],
  controllers: [
    AttendanceController,
    AttendanceRecordsController,
    ClassSessionRecordsController,
  ],
  providers: [
    AttendanceService,
    AttendanceHistoryService,
    AttendanceGuard,
    RosterService,
    ClassSessionRecordsService,
    { provide: APP_FILTER, useClass: AttendanceExceptionFilter },
  ],
  exports: [AttendanceService, AttendanceHistoryService, RosterService],
})
export class AttendanceModule {}
