import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
} from '@nestjs/common';
import { ClassroomsExampleService } from './classrooms-example.service';

function positiveInteger(value, name, maximum, fallback) {
  if (value === undefined && fallback !== undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) > maximum
  ) {
    throw new BadRequestException(
      `${name} must be an integer between 1 and ${maximum}.`,
    );
  }
  return Number(value);
}

@Controller('examples/classrooms')
export class ClassroomsExampleController {
  constructor(classrooms) {
    this.classrooms = classrooms;
  }

  @Get()
  list(query) {
    const page = positiveInteger(query.page, 'page', 10000, 1);
    const limit = positiveInteger(query.limit, 'limit', 100, 20);
    return this.classrooms.list(page, limit);
  }

  @Get(':id')
  findOne(id) {
    return this.classrooms.findOne(positiveInteger(id, 'id', 4294967295));
  }
}

// Babel legacy decorators do not support parameter decorator syntax in JS.
Inject(ClassroomsExampleService)(ClassroomsExampleController, undefined, 0);
Query()(ClassroomsExampleController.prototype, 'list', 0);
Param('id')(ClassroomsExampleController.prototype, 'findOne', 0);
