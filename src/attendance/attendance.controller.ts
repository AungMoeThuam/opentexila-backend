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
import { CurrentUser } from '../auth/current-user.decorator';
import type { AttendanceCaller } from './attendance.rules';
import {
  ClassSessionsQueryDto,
  ClassSessionParamsDto,
} from './dto/attendance-query.dto';
import { CheckInDto } from './dto/check-in.dto';

@Controller()
@UseGuards(AttendanceGuard)
export class AttendanceController {
  constructor(public readonly attendance: AttendanceService) {}

  @Get('me/class-sessions')
  list(
    @CurrentUser() user: AttendanceCaller,
    @Query() query: ClassSessionsQueryDto,
  ) {
    return this.attendance.list(user, query);
  }

  @Get('class-sessions/:classSessionId')
  detail(
    @CurrentUser() user: AttendanceCaller,
    @Param() params: ClassSessionParamsDto,
  ) {
    return this.attendance.detail(user, params.classSessionId);
  }

  @Post('class-sessions/:classSessionId/check-ins')
  @HttpCode(200)
  checkIn(
    @CurrentUser() user: AttendanceCaller,
    @Param() params: ClassSessionParamsDto,
    @Body() body: CheckInDto,
  ) {
    return this.attendance.checkIn(user, params.classSessionId, body);
  }
}
