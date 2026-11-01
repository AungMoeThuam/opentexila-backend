import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceGuard } from './attendance.guard';
import { CurrentUser } from './current-user.decorator';
import {
  type AttendanceCaller,
  listQuery,
  locationBody,
  positiveInteger,
} from './attendance.rules';

@Controller()
@UseGuards(AttendanceGuard)
export class AttendanceController {
  constructor(public readonly attendance: AttendanceService) {}

  @Get('me/class-sessions')
  list(
    @CurrentUser() user: AttendanceCaller,
    @Query() query: Record<string, any>,
  ) {
    return this.attendance.list(user, listQuery(query));
  }

  @Get('class-sessions/:classSessionId')
  detail(
    @CurrentUser() user: AttendanceCaller,
    @Param('classSessionId') id: unknown,
  ) {
    return this.attendance.detail(user, positiveInteger(id, 'classSessionId'));
  }

  @Post('class-sessions/:classSessionId/check-ins')
  @HttpCode(200)
  checkIn(
    @CurrentUser() user: AttendanceCaller,
    @Param('classSessionId') id: unknown,
    @Body() body: unknown,
  ) {
    return this.attendance.checkIn(
      user,
      positiveInteger(id, 'classSessionId'),
      locationBody(body),
    );
  }
}
