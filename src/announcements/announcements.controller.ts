import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth-request';
import { AnnouncementsService } from './announcements.service';
import {
  AnnouncementParamsDto,
  ClassAnnouncementsParamsDto,
  CreateAnnouncementDto,
  ListAllAnnouncementsQueryDto,
  ListAnnouncementsQueryDto,
  UpdateAnnouncementDto,
} from './dto/announcement.dto';

// Reading is open to every signed-in role; the service decides which classes
// the user may see. Writing is limited by role here and by class and author in
// the service.
@Controller()
@UseGuards(AttendanceGuard)
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get('announcements')
  listAll(
    @Query() query: ListAllAnnouncementsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcements.listAll(user, query);
  }

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

  @Post('classes/:classId/announcements')
  @Roles('lecturer')
  create(
    @Param() params: ClassAnnouncementsParamsDto,
    @Body() body: CreateAnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcements.create(user, params.classId, body);
  }

  @Patch('announcements/:announcementId')
  @Roles('lecturer')
  update(
    @Param() params: AnnouncementParamsDto,
    @Body() body: UpdateAnnouncementDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.announcements.update(user, params.announcementId, body);
  }

  @Delete('announcements/:announcementId')
  @Roles('lecturer', 'admin')
  @HttpCode(204)
  async remove(
    @Param() params: AnnouncementParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.announcements.remove(user, params.announcementId);
  }
}
