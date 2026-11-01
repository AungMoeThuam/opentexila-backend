import { Inject, Module, RequestMethod } from '@nestjs/common';
import { DATABASE } from '../database/database.constants';
import { createDevAuthMiddleware } from './dev-auth';

@Module({})
export class DevAuthModule {
  constructor(database) {
    this.middleware = createDevAuthMiddleware(database);
  }
  configure(consumer) {
    consumer
      .apply(this.middleware)
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
Inject(DATABASE)(DevAuthModule, undefined, 0);
