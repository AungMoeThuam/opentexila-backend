import { Module } from '@nestjs/common';
import { ClassSessionRecordsController } from './class-session-records.controller';
import { ClassSessionRecordsService } from './class-session-records.service';
import { MeClassSessionsController } from './me-class-sessions.controller';
import { MeClassSessionsService } from './me-class-sessions.service';

@Module({
  controllers: [MeClassSessionsController, ClassSessionRecordsController],
  providers: [MeClassSessionsService, ClassSessionRecordsService],
})
export class AttendanceModule {}
