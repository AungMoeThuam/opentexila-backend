import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ExamplesModule } from './examples/examples.module';
import { AttendanceModule } from './attendance/attendance.module';
import { DevAuthModule } from './dev/dev-auth.module';
import { AuthModule } from './auth/auth.module';
import { jwtAuthEnabled } from './auth/auth.config';
import { devAuthEnabled } from './dev/dev-auth';

@Module({
  imports: [
    DatabaseModule,
    AttendanceModule,
    ...(jwtAuthEnabled() ? [AuthModule] : []),
    ...(devAuthEnabled() ? [DevAuthModule] : []),
    ...(process.env.NODE_ENV === 'development' ? [ExamplesModule] : []),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
