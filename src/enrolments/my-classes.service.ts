import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { Class } from '../database/entities';
import type { AuthenticatedUser } from '../auth/auth-request';
import { ApiException } from '../common/api-exception';
import { pageMeta } from '../common/query-reader';
import { toClassSummary } from '../attendance/class-summary';
import { MyClassesQueryDto } from './my-classes-query.dto';

@Injectable()
export class MyClassesService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async list(user: AuthenticatedUser, query: MyClassesQueryDto) {
    if (!['student', 'lecturer'].includes(user.role))
      throw new ApiException(
        403,
        'FORBIDDEN',
        'Only students and lecturers can list their classes.',
      );
    const builder = this.database
      .getRepository(Class)
      .createQueryBuilder('class')
      .innerJoinAndSelect('class.course', 'course')
      .innerJoinAndSelect('class.lecturer', 'lecturer');
    if (user.role === 'lecturer') {
      builder.where('class.lecturer_id = :userId', { userId: user.id });
    } else {
      builder.where(
        'EXISTS (SELECT 1 FROM enrolments e WHERE e.class_id = class.id AND e.student_id = :userId)',
        { userId: user.id },
      );
    }
    if (query.courseId !== undefined)
      builder.andWhere('class.course_id = :courseId', {
        courseId: query.courseId,
      });
    if (query.term !== undefined)
      builder.andWhere('BINARY class.term = BINARY :term', {
        term: query.term,
      });
    const [classes, total] = await builder
      .orderBy('class.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      data: classes.map(toClassSummary),
      meta: pageMeta(query.page, query.limit, total),
    };
  }
}
