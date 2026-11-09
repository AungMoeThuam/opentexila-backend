import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { Roles } from '../auth/roles.decorator';
import { CoursesService } from './courses.service';
import {
  CourseParamsDto,
  CreateCourseDto,
  OptionsQueryDto,
  UpdateCourseDto,
} from './dto/course.dto';

@Controller('courses')
@UseGuards(AttendanceGuard)
@Roles('admin')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  list(@Query() query: OptionsQueryDto) {
    return this.coursesService.listCourses(query);
  }

  @Post()
  create(@Body() body: CreateCourseDto) {
    return this.coursesService.createCourse(body);
  }

  @Patch(':courseId')
  update(@Param() params: CourseParamsDto, @Body() body: UpdateCourseDto) {
    return this.coursesService.updateCourse(params.courseId, body);
  }
}

@Controller('lecturers')
@UseGuards(AttendanceGuard)
@Roles('admin')
export class LecturersController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  list(@Query() query: OptionsQueryDto) {
    return this.coursesService.listLecturers(query);
  }
}
