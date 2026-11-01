import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AttendanceService } from './attendance.service';
import { AttendanceGuard, type AttendanceRequest } from './attendance.guard';
import { listQuery, locationBody, positiveInteger } from './attendance.rules';

@Controller()
@UseGuards(AttendanceGuard)
export class AttendanceController {
  readonly attendance: AttendanceService;

  constructor(@Inject(AttendanceService) attendance: AttendanceService) {
    this.attendance = attendance;
  }

  @Get('me/class-sessions')
  list(@Req() request: AttendanceRequest, @Query() query: Record<string, any>) {
    return this.attendance.list(request.attendanceUser!, listQuery(query));
  }

  @Get('class-sessions/:classSessionId')
  detail(
    @Req() request: AttendanceRequest,
    @Param('classSessionId') id: unknown,
  ) {
    return this.attendance.detail(
      request.attendanceUser!,
      positiveInteger(id, 'classSessionId'),
    );
  }

  @Post('class-sessions/:classSessionId/check-ins')
  @HttpCode(200)
  checkIn(
    @Req() request: AttendanceRequest,
    @Param('classSessionId') id: unknown,
    @Body() body: unknown,
  ) {
    return this.attendance.checkIn(
      request.attendanceUser!,
      positiveInteger(id, 'classSessionId'),
      locationBody(body),
    );
  }
}
