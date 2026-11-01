import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceGuard } from './attendance.guard';
import { AttendanceExceptionFilter } from './attendance.filter';
import { RosterService } from './roster.service';

@Module({
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    AttendanceGuard,
    RosterService,
    { provide: APP_FILTER, useClass: AttendanceExceptionFilter },
  ],
  exports: [AttendanceService, RosterService],
import { ClassSessionRecordsController } from './class-session-records.controller';
import { ClassSessionRecordsService } from './class-session-records.service';
import { MeClassSessionsController } from './me-class-sessions.controller';
import { MeClassSessionsService } from './me-class-sessions.service';

@Module({
  controllers: [MeClassSessionsController, ClassSessionRecordsController],
  providers: [MeClassSessionsService, ClassSessionRecordsService],
})
export class AttendanceModule {}
