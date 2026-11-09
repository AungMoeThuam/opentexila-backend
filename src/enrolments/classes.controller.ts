import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { Roles } from '../auth/roles.decorator';
import { ClassesQueryDto } from './dto/classes-query.dto';
import { EnrolmentsService } from './enrolments.service';

@Controller('classes')
@UseGuards(AttendanceGuard)
@Roles('admin')
export class ClassesController {
  constructor(private readonly enrolmentsService: EnrolmentsService) {}

  @Get()
  list(@Query() query: ClassesQueryDto) {
    return this.enrolmentsService.listClasses(query);
  }
}
