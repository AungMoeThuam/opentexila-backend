import { Module } from '@nestjs/common';
import { ClassroomsExampleController } from './classrooms-example.controller';
import { ClassroomsExampleService } from './classrooms-example.service';

@Module({
  controllers: [ClassroomsExampleController],
  providers: [ClassroomsExampleService],
})
export class ExamplesModule {}
