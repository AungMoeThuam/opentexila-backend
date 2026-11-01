import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { DataSource, FindOptionsSelect, Repository } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { ClassEntity, ClassSchema } from '../database/entities/class.schema';

const publicFields: FindOptionsSelect<ClassEntity> = {
  id: true,
  section: true,
  course: { id: true, code: true, name: true },
  term: true,
  room_label: true,
};

// Explicit response mapping keeps future entity fields out of API responses.
function toResponse(classroom: ClassEntity) {
  return {
    id: classroom.id,
    section: classroom.section,
    term: classroom.term,
    room_label: classroom.room_label,
    course: {
      id: classroom.course!.id,
      code: classroom.course!.code,
      name: classroom.course!.name,
    },
  };
}

@Injectable()
export class ClassroomsExampleService {
  private readonly classrooms: Repository<ClassEntity>;

  constructor(@Inject(DATABASE) database: DataSource) {
    this.classrooms = database.getRepository(ClassSchema);
  }

  async list(page: number, limit: number) {
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

  async findOne(id: number) {
    const classroom = await this.classrooms.findOne({
      where: { id },
      select: publicFields,
      relations: { course: true },
    });
    if (!classroom) throw new NotFoundException('Classroom not found.');
    return { data: toResponse(classroom) };
  }
}
