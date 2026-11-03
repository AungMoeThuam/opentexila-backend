import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { jwtOptions } from './auth.config';

// Imported when the login endpoints are implemented; never installs a global guard.
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => jwtOptions() })],
  exports: [JwtModule],
})
export class AuthModule {}
