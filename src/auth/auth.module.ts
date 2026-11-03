import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthCookies } from './auth.cookies';
import { AuthThrottleGuard } from './auth-throttle.guard';
import { jwtOptions } from './auth.config';

// Authentication is opt-in; this module never installs a global guard.
@Module({
  imports: [JwtModule.registerAsync({ useFactory: () => jwtOptions() })],
  controllers: [AuthController],
  providers: [AuthService, AuthCookies, AuthThrottleGuard],
  exports: [AuthService],
})
export class AuthModule {}
