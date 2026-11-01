import { DevAuthModule } from './dev/dev-auth.module';
import { devAuthEnabled } from './dev/dev-auth';
import { AttendanceModule } from './attendance/attendance.module';
import { Module } from '@nestjs/common';
import { AttendanceModule } from './attendance/attendance.module';
import { DatabaseModule } from './database/database.module';
import { ExamplesModule } from './examples/examples.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { AttendanceModule } from './attendance/attendance.module';

@Module({
  imports: [
    DatabaseModule,
    ClassroomsModule,
    AttendanceModule,
    AttendanceModule,
    ...(devAuthEnabled() ? [DevAuthModule] : []),
    ...(process.env.NODE_ENV === 'development' ? [ExamplesModule] : []),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
