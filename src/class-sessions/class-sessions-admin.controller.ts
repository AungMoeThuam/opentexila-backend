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
import { AttendanceGuard } from '../attendance/attendance.guard';
import { Roles } from '../auth/roles.decorator';
import { ClassSessionParamsDto } from '../attendance/dto/attendance-query.dto';
import { ClassSessionsAdminService } from './class-sessions-admin.service';
import {
  CreateClassSessionDto,
  ListManagedSessionsQueryDto,
  ManagedClassParamsDto,
} from './dto/class-session-admin.dto';

// Admin-only session management. The timetable page keeps its own routes on
// /class-sessions (list by date, batch reschedule); these routes are different.
@Controller()
@UseGuards(AttendanceGuard)
@Roles('admin')
export class ClassSessionsAdminController {
  constructor(private readonly sessions: ClassSessionsAdminService) {}

  @Get('classes/:classId/class-sessions')
  list(
    @Param() params: ManagedClassParamsDto,
    @Query() query: ListManagedSessionsQueryDto,
  ) {
    return this.sessions.list(params.classId, query);
  }

  @Post('classes/:classId/class-sessions')
  create(
    @Param() params: ManagedClassParamsDto,
    @Body() body: CreateClassSessionDto,
  ) {
    return this.sessions.create(params.classId, body);
  }

  @Post('class-sessions/:classSessionId/cancel')
  @HttpCode(200)
  cancel(@Param() params: ClassSessionParamsDto) {
    return this.sessions.cancel(params.classSessionId);
  }
}
