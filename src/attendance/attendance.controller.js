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
import { AttendanceGuard } from './attendance.guard';
import { listQuery, locationBody, positiveInteger } from './attendance.rules';

@Controller()
@UseGuards(AttendanceGuard)
export class AttendanceController {
  constructor(attendance) {
    this.attendance = attendance;
  }
  @Get('me/class-sessions')
  list(request, query) {
    return this.attendance.list(request.attendanceUser, listQuery(query));
  }
  @Get('class-sessions/:classSessionId')
  detail(request, id) {
    return this.attendance.detail(
      request.attendanceUser,
      positiveInteger(id, 'classSessionId'),
    );
  }
  @Post('class-sessions/:classSessionId/check-ins')
  @HttpCode(200)
  checkIn(request, id, body) {
    return this.attendance.checkIn(
      request.attendanceUser,
      positiveInteger(id, 'classSessionId'),
      locationBody(body),
    );
  }
}
Inject(AttendanceService)(AttendanceController, undefined, 0);
for (const method of ['list', 'detail', 'checkIn'])
  Req()(AttendanceController.prototype, method, 0);
Query()(AttendanceController.prototype, 'list', 1);
for (const method of ['detail', 'checkIn'])
  Param('classSessionId')(AttendanceController.prototype, method, 1);
Body()(AttendanceController.prototype, 'checkIn', 2);
