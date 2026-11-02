import { Controller, Get, Param, Query } from '@nestjs/common';
import { ClassroomsExampleService } from './classrooms-example.service';
import {
  ClassroomPaginationPipe,
  ClassroomParamsPipe,
  type ClassroomPagination,
  type ClassroomParams,
} from './classrooms-example.pipes';

@Controller('examples/classrooms')
export class ClassroomsExampleController {
  constructor(private readonly classrooms: ClassroomsExampleService) {}

  @Get()
  list(@Query(ClassroomPaginationPipe) query: ClassroomPagination) {
    return this.classrooms.list(query.page, query.limit);
  }

  @Get(':id')
  findOne(@Param(ClassroomParamsPipe) params: ClassroomParams) {
    return this.classrooms.findOne(params.id);
  }
}
