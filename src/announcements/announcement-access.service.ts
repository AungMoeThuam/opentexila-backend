import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { Class, Enrolment } from '../database/entities';
import type { AuthenticatedUser } from '../auth/auth-request';

// Who may see a class and its announcements: any admin, the assigned lecturer,
// and enrolled students. Other users get the same answer as for a missing class,
// so the API never shows which classes exist. Later announcement features
// (create, edit, delete, like, comment) reuse this check.
@Injectable()
export class AnnouncementAccessService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async canSeeClass(
    user: AuthenticatedUser,
    classId: number,
  ): Promise<boolean> {
    const classroom = await this.database
      .getRepository(Class)
      .findOneBy({ id: classId });
    return Boolean(classroom && (await this.mayRead(user, classroom)));
  }

  // The class with its course and lecturer, for pages that show which class
  // the announcements belong to. Null when the user may not see the class.
  async findVisibleClass(
    user: AuthenticatedUser,
    classId: number,
  ): Promise<Class | null> {
    const classroom = await this.database.getRepository(Class).findOne({
      where: { id: classId },
      relations: { course: true, lecturer: true },
    });
    return classroom && (await this.mayRead(user, classroom))
      ? classroom
      : null;
  }

  // SQL that limits announcements (alias `a`) to the classes the user may see:
  // enrolled classes for a student, taught classes for a lecturer, all for an
  // admin. Same rules as canSeeClass, written for lists of posts.
  scopeCondition(user: AuthenticatedUser): { sql: string; params: unknown[] } {
    if (user.role === 'admin') return { sql: '1 = 1', params: [] };
    if (user.role === 'lecturer')
      return {
        sql: 'a.class_id IN (SELECT id FROM classes WHERE lecturer_id = ?)',
        params: [user.id],
      };
    if (user.role === 'student')
      return {
        sql: 'a.class_id IN (SELECT class_id FROM enrolments WHERE student_id = ?)',
        params: [user.id],
      };
    return { sql: '1 = 0', params: [] };
  }

  private async mayRead(
    user: AuthenticatedUser,
    classroom: Class,
  ): Promise<boolean> {
    if (user.role === 'admin') return true;
    if (user.role === 'lecturer') return classroom.lecturer_id === user.id;
    if (user.role === 'student') {
      const enrolment = await this.database
        .getRepository(Enrolment)
        .findOneBy({ class_id: classroom.id, student_id: user.id });
      return Boolean(enrolment);
    }
    return false;
  }
}
