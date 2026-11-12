import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth-request';
import { AnnouncementsService } from './announcements.service';
import {
  AnnouncementParamsDto,
  ClassAnnouncementsParamsDto,
  ListAnnouncementsQueryDto,
} from './dto/announcement.dto';

// Any signed-in role may call these; the service decides which classes the
// user may see.
@Controller()
@UseGuards(AttendanceGuard)
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get('classes/:classId/announcements')
  list(
    @Param() params: ClassAnnouncementsParamsDto,
    @Query() query: ListAnnouncementsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcements.list(user, params.classId, query);
  }

  @Get('announcements/:announcementId')
  get(
    @Param() params: AnnouncementParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcements.get(user, params.announcementId);
  }
}
