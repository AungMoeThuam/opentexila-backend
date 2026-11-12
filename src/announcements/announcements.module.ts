import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { AnnouncementAccessService } from './announcement-access.service';
import { AnnouncementEngagementController } from './announcement-engagement.controller';
import { AnnouncementEngagementService } from './announcement-engagement.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsService } from './announcements.service';

@Module({
  imports: [AttendanceModule],
  controllers: [AnnouncementsController, AnnouncementEngagementController],
  providers: [
    AnnouncementsService,
    AnnouncementEngagementService,
    AnnouncementAccessService,
  ],
  exports: [AnnouncementAccessService],
})
export class AnnouncementsModule {}
