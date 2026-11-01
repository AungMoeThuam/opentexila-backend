import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ExamplesModule } from './examples/examples.module';
import { ClassroomsModule } from './classrooms/classrooms.module';
import { AttendanceModule } from './attendance/attendance.module';

@Module({
  imports: [
    DatabaseModule,
    ClassroomsModule,
    AttendanceModule,
    ...(process.env.NODE_ENV === 'development' ? [ExamplesModule] : []),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
