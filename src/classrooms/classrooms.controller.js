import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import { ClassroomsService } from './classrooms.service';

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

function isDemoRequest(query, req) {
  if (query?.demo === 'true' || query?.demo === '1') return true;
  const path = req?.originalUrl ?? req?.url ?? '';
  return path.includes('/demo/');
}

@Controller(['classes', 'demo/classes', 'classrooms', 'demo/classrooms'])
export class ClassroomsController {
  constructor(classroomsService) {
    this.classroomsService = classroomsService;
  }

  @Get()
  list(query, req) {
    const page = positiveInteger(query?.page, 'page', 10000, 1);
    const limit = positiveInteger(query?.limit, 'limit', 100, 20);
    const forceDemo = isDemoRequest(query, req);

    return this.classroomsService.list({
      page,
      limit,
      search: query?.search ?? query?.q,
      term: query?.term,
      teacher_id: query?.teacher_id,
      forceDemo,
    });
  }

  @Get(':id')
  findOne(id, req) {
    const classId = positiveInteger(id, 'id', 4294967295);
    const forceDemo = isDemoRequest(undefined, req);
    return this.classroomsService.findOne(classId, { forceDemo });
  }

  @Get(':id/class-meetings')
  findMeetings(id, query, req) {
    const classId = positiveInteger(id, 'id', 4294967295);
    const page = positiveInteger(query?.page, 'page', 10000, 1);
    const limit = positiveInteger(query?.limit, 'limit', 100, 20);
    const forceDemo = isDemoRequest(query, req);

    return this.classroomsService.findMeetings(classId, {
      page,
      limit,
      forceDemo,
    });
  }

  @Get(':id/meetings')
  findMeetingsAlias(id, query, req) {
    return this.findMeetings(id, query, req);
  }
}

// Babel legacy decorators do not support parameter decorator syntax in JS.
Inject(ClassroomsService)(ClassroomsController, undefined, 0);

Query()(ClassroomsController.prototype, 'list', 0);
Req()(ClassroomsController.prototype, 'list', 1);

Param('id')(ClassroomsController.prototype, 'findOne', 0);
Req()(ClassroomsController.prototype, 'findOne', 1);

Param('id')(ClassroomsController.prototype, 'findMeetings', 0);
Query()(ClassroomsController.prototype, 'findMeetings', 1);
Req()(ClassroomsController.prototype, 'findMeetings', 2);

Param('id')(ClassroomsController.prototype, 'findMeetingsAlias', 0);
Query()(ClassroomsController.prototype, 'findMeetingsAlias', 1);
Req()(ClassroomsController.prototype, 'findMeetingsAlias', 2);
