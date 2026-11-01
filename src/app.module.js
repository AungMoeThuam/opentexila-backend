import { Module } from '@nestjs/common';
import { AttendanceModule } from './attendance/attendance.module';
import { DatabaseModule } from './database/database.module';
import { ExamplesModule } from './examples/examples.module';

@Module({
  imports: [
    DatabaseModule,
    AttendanceModule,
    ...(process.env.NODE_ENV === 'development' ? [ExamplesModule] : []),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
