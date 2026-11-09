import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClassRosterController } from './class-roster.controller';
import { ClassRosterService } from './class-roster.service';
import { MyClassesController } from './my-classes.controller';
import { MyClassesService } from './my-classes.service';
import { ClassesController } from './classes.controller';
import { ClassEnrolmentsController } from './class-enrolments.controller';
import { EnrolmentsService } from './enrolments.service';

@Module({
  imports: [AttendanceModule],
  controllers: [
    MyClassesController,
    ClassesController,
    ClassEnrolmentsController,
    ClassRosterController
  ],
  providers: [MyClassesService,  EnrolmentsService, ClassRosterService],
  exports: [EnrolmentsService],
})
export class EnrolmentsModule {}
