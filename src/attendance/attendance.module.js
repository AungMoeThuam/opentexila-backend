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
})
export class AttendanceModule {}
