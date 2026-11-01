import { Module } from '@nestjs/common';
import { MeClassSessionsController } from './me-class-sessions.controller';
import { MeClassSessionsService } from './me-class-sessions.service';

@Module({
  controllers: [MeClassSessionsController],
  providers: [MeClassSessionsService],
})
export class AttendanceModule {}
