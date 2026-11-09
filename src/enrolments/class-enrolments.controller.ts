import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { Roles } from '../auth/roles.decorator';
import { AddEnrolmentDto } from './dto/add-enrolment.dto';
import { ClassParamsDto, EnrolmentParamsDto } from './dto/class-params.dto';
import { EnrolmentsService } from './enrolments.service';

@Controller('classes/:classId/enrolments')
@UseGuards(AttendanceGuard)
@Roles('admin')
export class ClassEnrolmentsController {
  constructor(private readonly enrolmentsService: EnrolmentsService) {}

  @Post()
  enrolStudent(@Param() params: ClassParamsDto, @Body() body: AddEnrolmentDto) {
    return this.enrolmentsService.addEnrolment(params.classId, body.student_id);
  }

  @Delete(':studentId')
  @HttpCode(204)
  async removeStudent(@Param() params: EnrolmentParamsDto): Promise<void> {
    await this.enrolmentsService.removeEnrolment(
      params.classId,
      params.studentId,
    );
  }
}
