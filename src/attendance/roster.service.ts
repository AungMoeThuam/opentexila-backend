import { Inject, Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import type { ClassEntity, ClassSessionEntity } from '../database/entities';
import { fail } from './attendance.rules';

export async function databaseNow(manager: EntityManager): Promise<Date> {
  const [row] = await manager.query<{ now: Date }[]>(
    'SELECT UTC_TIMESTAMP(3) AS now',
  );
  return new Date(row.now);
}

// Call inside a transaction. All attendance/enrolment/finalisation writers must
// use the same class -> class_session lock order.
export async function lockClassSession(
  manager: EntityManager,
  id: number,
): Promise<{ classroom: ClassEntity; session: ClassSessionEntity }> {
  const [reference] = await manager.query<{ class_id: number }[]>(
    'SELECT class_id FROM class_sessions WHERE id = ?',
    [id],
  );
  if (!reference)
    fail(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found.');
  const [classroom] = await manager.query<ClassEntity[]>(
    'SELECT * FROM classes WHERE id = ? FOR UPDATE',
    [reference.class_id],
  );
  const [session] = await manager.query<ClassSessionEntity[]>(
    'SELECT * FROM class_sessions WHERE id = ? FOR UPDATE',
    [id],
  );
  if (!classroom || !session || session.class_id !== classroom.id)
    fail(404, 'RESOURCE_NOT_FOUND', 'The requested resource was not found.');
  return { classroom, session };
}

export async function materialiseLockedRoster(
  manager: EntityManager,
  session: ClassSessionEntity,
  now: Date,
): Promise<void> {
  if (session.state === 'cancelled' || now < session.starts_at) return;
  // A duplicate must never reset an existing present/late/absent record.
  await manager.query(
    `INSERT INTO attendance_records (class_session_id, student_id, status)
    SELECT ?, e.student_id, 'pending' FROM enrolments e WHERE e.class_id = ?
    ON DUPLICATE KEY UPDATE student_id = attendance_records.student_id`,
    [session.id, session.class_id],
  );
}

@Injectable()
export class RosterService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async materialise(classSessionId: number) {
    return this.database.transaction(async (manager) => {
      const { session } = await lockClassSession(manager, classSessionId);
      const now = await databaseNow(manager);
      await materialiseLockedRoster(manager, session, now);
      return { class_session_id: session.id };
    });
  }
}
