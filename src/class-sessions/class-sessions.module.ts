import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ClassSessionsAdminController } from './class-sessions-admin.controller';
import { ClassSessionsAdminService } from './class-sessions-admin.service';

@Module({
  imports: [AttendanceModule],
  controllers: [ClassSessionsAdminController],
  providers: [ClassSessionsAdminService],
})
export class ClassSessionsModule {}
