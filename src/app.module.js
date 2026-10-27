import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { ExamplesModule } from './examples/examples.module';

@Module({
  imports: [
    DatabaseModule,
    ...(process.env.NODE_ENV === 'development' ? [ExamplesModule] : []),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
