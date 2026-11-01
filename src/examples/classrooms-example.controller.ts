import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { ClassroomsExampleService } from './classrooms-example.service';

function positiveInteger(
  value: unknown,
  name: string,
  maximum: number,
  fallback?: number,
): number {
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
  constructor(private readonly classrooms: ClassroomsExampleService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const page = positiveInteger(query.page, 'page', 10000, 1);
    const limit = positiveInteger(query.limit, 'limit', 100, 20);
    return this.classrooms.list(page, limit);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.classrooms.findOne(positiveInteger(id, 'id', 4294967295));
  }
}
