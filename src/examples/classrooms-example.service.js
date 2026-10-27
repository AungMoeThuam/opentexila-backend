import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { ClassroomSchema } from '../database/entities/classroom.schema';

const publicFields = {
  id: true,
  code: true,
  name: true,
  subject: true,
  term: true,
  room_label: true,
};

// Explicit response mapping keeps future entity fields out of API responses.
function toResponse(classroom) {
  return Object.fromEntries(
    Object.keys(publicFields).map((field) => [field, classroom[field]]),
  );
}

@Injectable()
export class ClassroomsExampleService {
  constructor(database) {
    this.classrooms = database.getRepository(ClassroomSchema);
  }

  async list(page, limit) {
    const [classrooms, total] = await this.classrooms.findAndCount({
      where: { archived_at: IsNull() },
      select: publicFields,
      order: { id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: classrooms.map(toResponse),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id) {
    const classroom = await this.classrooms.findOne({
      where: { id, archived_at: IsNull() },
      select: publicFields,
    });
    if (!classroom) throw new NotFoundException('Classroom not found.');
    return { data: toResponse(classroom) };
  }
}

// JavaScript/Babel needs explicit constructor injection.
Inject(DATABASE)(ClassroomsExampleService, undefined, 0);
