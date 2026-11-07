import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { AuthenticatedUser } from '../auth/auth-request';
import { MyClassesQueryDto } from './my-classes-query.dto';
import { MyClassesService } from './my-classes.service';

@Controller('me/classes')
@UseGuards(AttendanceGuard)
@Roles('student', 'lecturer')
export class MyClassesController {
  constructor(private readonly classes: MyClassesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MyClassesQueryDto,
  ) {
    return this.classes.list(user, query);
  }
}
