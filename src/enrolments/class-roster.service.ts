import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { Class, Enrolment } from '../database/entities';
import type { AuthenticatedUser } from '../auth/auth-request';
import { ApiException } from '../common/api-exception';
import { pageMeta, type PageMeta } from '../common/query-reader';
import {
  toClassSummary,
  type ClassSummaryDto,
} from '../attendance/class-summary';
import type { ClassRosterQueryDto } from './class-roster-query.dto';

export interface RosterEntryDto {
  class_id: number;
  student_id: number;
  student: { id: number; name: string; email: string };
}

export interface ClassRosterResponseDto {
  data: RosterEntryDto[];
  context: { class: ClassSummaryDto };
  meta: PageMeta;
}

@Injectable()
export class ClassRosterService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  // Read-only roster of one class: any class for an admin, only the assigned
  // lecturer's own classes for a lecturer.
  async list(
    user: AuthenticatedUser,
    classId: number,
    query: ClassRosterQueryDto,
  ): Promise<ClassRosterResponseDto> {
    // A class of another lecturer looks the same as a missing class.
    const classroom = await this.database.getRepository(Class).findOne({
      relations: { course: true, lecturer: true },
      where:
        user.role === 'admin'
          ? { id: classId }
          : { id: classId, lecturer_id: user.id },
    });
    if (!classroom)
      throw new ApiException(404, 'RESOURCE_NOT_FOUND', 'Class not found.');
    const [enrolments, total] = await this.database
      .getRepository(Enrolment)
      .findAndCount({
        relations: { student: true },
        where: { class_id: classId },
        order: { student_id: 'ASC' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
    return {
      data: enrolments.map(toRosterEntry),
      context: { class: toClassSummary(classroom) },
      meta: pageMeta(query.page, query.limit, total),
    };
  }
}

// Needs the `student` relation loaded on the enrolment.
function toRosterEntry(enrolment: Enrolment): RosterEntryDto {
  const { student } = enrolment;
  if (!student) throw new Error('Roster entry requires the student relation.');
  return {
    class_id: enrolment.class_id,
    student_id: enrolment.student_id,
    student: { id: student.id, name: student.name, email: student.email },
  };
}
