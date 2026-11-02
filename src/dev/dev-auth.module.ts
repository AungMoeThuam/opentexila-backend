import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { DevAuthController } from './dev-auth.controller';
import { DevAuthService } from './dev-auth.service';
import { DevCsrfGuard } from './dev-auth.guard';
import { DevAuthSessionMiddleware } from './dev-auth.middleware';

@Module({
  controllers: [DevAuthController],
  providers: [DevAuthService, DevCsrfGuard, DevAuthSessionMiddleware],
})
export class DevAuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(DevAuthSessionMiddleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
