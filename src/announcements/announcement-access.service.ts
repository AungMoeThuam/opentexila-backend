import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { Class, Enrolment } from '../database/entities';
import type { AuthenticatedUser } from '../auth/auth-request';

// Who may see a class and its announcements: any admin, the assigned lecturer,
// and enrolled students. Other users get the same answer as for a missing class,
// so the API never shows which classes exist. Later announcement features
// (create, like, comment) reuse this check.
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
    if (!classroom) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'lecturer') return classroom.lecturer_id === user.id;
    if (user.role === 'student') {
      const enrolment = await this.database
        .getRepository(Enrolment)
        .findOneBy({ class_id: classId, student_id: user.id });
      return Boolean(enrolment);
    }
    return false;
  }
}
