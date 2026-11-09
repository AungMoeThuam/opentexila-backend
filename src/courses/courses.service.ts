import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { Course, User } from '../database/entities';
import { notFound } from '../common/api-exception';
import { pageMeta } from '../common/query-reader';
import {
  courseCodeTaken,
  definedEntries,
  duplicateKey,
  emptyUpdate,
} from './class-management.rules';
import type {
  CreateCourseDto,
  OptionsQueryDto,
  UpdateCourseDto,
} from './dto/course.dto';

export interface CourseDto {
  id: number;
  code: string;
  name: string;
}

export interface LecturerOptionDto {
  id: number;
  name: string;
  email: string;
}

// Escapes LIKE wildcards so `q` is matched literally as a substring.
export const likePattern = (q: string): string =>
  `%${q.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

const toCourse = (course: Course): CourseDto => ({
  id: course.id,
  code: course.code,
  name: course.name,
});

@Injectable()
export class CoursesService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async listCourses(query: OptionsQueryDto) {
    const builder = this.database
      .getRepository(Course)
      .createQueryBuilder('course');
    if (query.q !== undefined) {
      // `code` is ascii_bin; convert it so the match ignores case like `name`.
      builder.andWhere(
        '(CONVERT(course.code USING utf8mb4) LIKE :pattern OR course.name LIKE :pattern)',
        { pattern: likePattern(query.q) },
      );
    }
    const [courses, total] = await builder
      .orderBy('course.code', 'ASC')
      .addOrderBy('course.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      data: courses.map(toCourse),
      meta: pageMeta(query.page, query.limit, total),
    };
  }

  async createCourse(body: CreateCourseDto) {
    const values = { code: body.code, name: body.name };
    let id: number;
    try {
      const result = await this.database.getRepository(Course).insert(values);
      id = Number(result.identifiers[0]?.id);
    } catch (error) {
      if (duplicateKey(error) !== undefined) throw courseCodeTaken();
      throw error;
    }
    return { data: { id, ...values } };
  }

  async updateCourse(courseId: number, body: UpdateCourseDto) {
    const changes = definedEntries(body);
    if (Object.keys(changes).length === 0) throw emptyUpdate();
    const repository = this.database.getRepository(Course);
    const course = await repository.findOneBy({ id: courseId });
    if (!course) throw notFound('Course not found.');
    try {
      await repository.update({ id: courseId }, changes);
    } catch (error) {
      if (duplicateKey(error) !== undefined) throw courseCodeTaken();
      throw error;
    }
    return { data: toCourse({ ...course, ...changes }) };
  }

  // Only active lecturers can be assigned; only selector fields are returned.
  async listLecturers(query: OptionsQueryDto) {
    const builder = this.database
      .getRepository(User)
      .createQueryBuilder('user')
      .select(['user.id', 'user.name', 'user.email'])
      .where('user.role = :role', { role: 'lecturer' })
      .andWhere('user.status = :status', { status: 'active' });
    if (query.q !== undefined) {
      builder.andWhere(
        '(user.name LIKE :pattern OR user.email LIKE :pattern)',
        { pattern: likePattern(query.q) },
      );
    }
    const [users, total] = await builder
      .orderBy('user.name', 'ASC')
      .addOrderBy('user.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      data: users.map((user): LecturerOptionDto => ({
        id: user.id,
        name: user.name,
        email: user.email,
      })),
      meta: pageMeta(query.page, query.limit, total),
    };
  }
}
