import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClassManagementController } from './class-management.controller';
import { ClassManagementService } from './class-management.service';
import { CoursesController, LecturersController } from './courses.controller';
import { CoursesService } from './courses.service';

@Module({
  imports: [AttendanceModule],
  controllers: [
    CoursesController,
    LecturersController,
    ClassManagementController,
  ],
  providers: [CoursesService, ClassManagementService],
})
export class CoursesModule {}
