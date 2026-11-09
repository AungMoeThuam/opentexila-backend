import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { Roles } from '../auth/roles.decorator';
import { ClassParamsDto } from '../enrolments/dto/class-params.dto';
import { ClassManagementService } from './class-management.service';
import { CreateClassDto, UpdateClassDto } from './dto/class.dto';

// `GET /classes` stays in the enrolments ClassesController (#7); this
// controller adds only create, detail and update on the same resource.
@Controller('classes')
@UseGuards(AttendanceGuard)
@Roles('admin')
export class ClassManagementController {
  constructor(private readonly classes: ClassManagementService) {}

  @Post()
  create(@Body() body: CreateClassDto) {
    return this.classes.createClass(body);
  }

  @Get(':classId')
  detail(@Param() params: ClassParamsDto) {
    return this.classes.getClass(params.classId);
  }

  @Patch(':classId')
  update(@Param() params: ClassParamsDto, @Body() body: UpdateClassDto) {
    return this.classes.updateClass(params.classId, body);
  }
}
