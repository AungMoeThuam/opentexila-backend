import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DATABASE } from '../database/database.constants';
import { ClassSchema } from '../database/entities/class.schema';

const publicFields = {
  id: true,
  section: true,
  course: { id: true, code: true, name: true },
  term: true,
  room_label: true,
};

// Explicit response mapping keeps future entity fields out of API responses.
function toResponse(classroom) {
  return {
    id: classroom.id,
    section: classroom.section,
    term: classroom.term,
    room_label: classroom.room_label,
    course: {
      id: classroom.course.id,
      code: classroom.course.code,
      name: classroom.course.name,
    },
  };
}

@Injectable()
export class ClassroomsExampleService {
  constructor(database) {
    this.classrooms = database.getRepository(ClassSchema);
  }

  async list(page, limit) {
    const [classrooms, total] = await this.classrooms.findAndCount({
      select: publicFields,
      relations: { course: true },
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
      where: { id },
      select: publicFields,
      relations: { course: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found.');
    return { data: toResponse(classroom) };
  }
}

// JavaScript/Babel needs explicit constructor injection.
Inject(DATABASE)(ClassroomsExampleService, undefined, 0);
