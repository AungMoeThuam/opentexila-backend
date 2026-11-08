import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClassRosterController } from './class-roster.controller';
import { ClassRosterService } from './class-roster.service';
import { MyClassesController } from './my-classes.controller';
import { MyClassesService } from './my-classes.service';

@Module({
  imports: [AttendanceModule],
  controllers: [MyClassesController, ClassRosterController],
  providers: [MyClassesService, ClassRosterService],
})
export class EnrolmentsModule {}
