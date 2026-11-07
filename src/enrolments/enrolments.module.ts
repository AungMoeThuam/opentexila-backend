import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { MyClassesController } from './my-classes.controller';
import { MyClassesService } from './my-classes.service';

@Module({
  imports: [AttendanceModule],
  controllers: [MyClassesController],
  providers: [MyClassesService],
})
export class EnrolmentsModule {}
