import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { Class, Enrolment, User } from '../database/entities';
import { ApiException, notFound } from '../common/api-exception';
import { pageMeta } from '../common/query-reader';
import { toClassSummary } from '../attendance/class-summary';
import { ClassesQueryDto } from './dto/classes-query.dto';

@Injectable()
export class EnrolmentsService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async listClasses(query: ClassesQueryDto) {
    const builder = this.database
      .getRepository(Class)
      .createQueryBuilder('class')
      .innerJoinAndSelect('class.course', 'course')
      .innerJoinAndSelect('class.lecturer', 'lecturer');

    if (query.courseId !== undefined) {
      builder.andWhere('class.course_id = :courseId', {
        courseId: query.courseId,
      });
    }
    if (query.term !== undefined) {
      builder.andWhere('BINARY class.term = BINARY :term', {
        term: query.term,
      });
    }

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

  async addEnrolment(classId: number, studentId: number) {
    const classEntity = await this.database
      .getRepository(Class)
      .findOneBy({ id: classId });
    if (!classEntity) {
      throw notFound('Class not found.');
    }

    const student = await this.database
      .getRepository(User)
      .findOneBy({ id: studentId });
    if (!student) {
      throw notFound('Student not found.');
    }

    if (student.role !== 'student' || student.status !== 'active') {
      throw new ApiException(
        422,
        'STUDENT_NOT_ELIGIBLE',
        'The selected user cannot be enrolled as a student.',
        { student_id: 'Selected account must be an active student.' },
      );
    }

    const existing = await this.database
      .getRepository(Enrolment)
      .findOneBy({ class_id: classId, student_id: studentId });
    if (existing) {
      throw new ApiException(
        409,
        'ENROLMENT_ALREADY_EXISTS',
        'This student is already enrolled in the selected class.',
      );
    }

    try {
      await this.database.getRepository(Enrolment).insert({
        class_id: classId,
        student_id: studentId,
      });
    } catch (error: any) {
      if (
        error?.code === 'ER_DUP_ENTRY' ||
        error?.errno === 1062 ||
        error?.message?.includes('Duplicate entry')
      ) {
        throw new ApiException(
          409,
          'ENROLMENT_ALREADY_EXISTS',
          'This student is already enrolled in the selected class.',
        );
      }
      throw error;
    }

    return {
      data: {
        class_id: classId,
        student_id: studentId,
        student: {
          id: student.id,
          name: student.name,
          email: student.email,
        },
      },
    };
  }

  async removeEnrolment(classId: number, studentId: number): Promise<void> {
    const classEntity = await this.database
      .getRepository(Class)
      .findOneBy({ id: classId });
    if (!classEntity) {
      throw notFound('Class not found.');
    }

    const enrolment = await this.database
      .getRepository(Enrolment)
      .findOneBy({ class_id: classId, student_id: studentId });
    if (!enrolment) {
      throw notFound('Enrolment not found.');
    }

    await this.database.getRepository(Enrolment).delete({
      class_id: classId,
      student_id: studentId,
    });
  }
}
