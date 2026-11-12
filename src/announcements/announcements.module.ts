import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { AnnouncementAccessService } from './announcement-access.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  imports: [AttendanceModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementsService, AnnouncementAccessService],
  exports: [AnnouncementAccessService],
})
export class AnnouncementsModule {}
