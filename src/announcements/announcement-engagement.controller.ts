import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth-request';
import { AnnouncementEngagementService } from './announcement-engagement.service';
import { AnnouncementParamsDto } from './dto/announcement.dto';
import {
  CommentParamsDto,
  CreateCommentDto,
  ListCommentsQueryDto,
} from './dto/comment.dto';

// Likes and comments. Liking and writing are for the lecturer of the class and
// enrolled students, so admins are stopped by role here. Reading comments and
// deleting one are open to every role; the service checks class and author.
@Controller()
@UseGuards(AttendanceGuard)
export class AnnouncementEngagementController {
  constructor(private readonly engagement: AnnouncementEngagementService) {}

  @Put('announcements/:announcementId/like')
  @Roles('lecturer', 'student')
  like(
    @Param() params: AnnouncementParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.engagement.setLike(user, params.announcementId, true);
  }

  @Delete('announcements/:announcementId/like')
  @Roles('lecturer', 'student')
  unlike(
    @Param() params: AnnouncementParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.engagement.setLike(user, params.announcementId, false);
  }

  @Get('announcements/:announcementId/comments')
  listComments(
    @Param() params: AnnouncementParamsDto,
    @Query() query: ListCommentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.engagement.listComments(user, params.announcementId, query);
  }

  @Post('announcements/:announcementId/comments')
  @Roles('lecturer', 'student')
  createComment(
    @Param() params: AnnouncementParamsDto,
    @Body() body: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.engagement.createComment(user, params.announcementId, body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  async deleteComment(
    @Param() params: CommentParamsDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.engagement.deleteComment(user, params.commentId);
  }
}
