import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceGuard, type AttendanceRequest } from './attendance.guard';
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
    @Req() request: AttendanceRequest,
    @Query() query: Record<string, any>,
    @CurrentUser() user?: AttendanceCaller,
  ) {
    const caller = user ?? request?.attendanceUser!;
    return this.attendance.list(caller, listQuery(query));
  }

  @Get('class-sessions/:classSessionId')
  detail(
    @Req() request: AttendanceRequest,
    @Param('classSessionId') id: unknown,
    @CurrentUser() user?: AttendanceCaller,
  ) {
    const caller = user ?? request?.attendanceUser!;
    return this.attendance.detail(
      caller,
      positiveInteger(id, 'classSessionId'),
    );
  }

  @Post('class-sessions/:classSessionId/check-ins')
  @HttpCode(200)
  checkIn(
    @Req() request: AttendanceRequest,
    @Param('classSessionId') id: unknown,
    @Body() body: unknown,
    @CurrentUser() user?: AttendanceCaller,
  ) {
    const caller = user ?? request?.attendanceUser!;
    return this.attendance.checkIn(
      caller,
      positiveInteger(id, 'classSessionId'),
      locationBody(body),
    );
  }
}
