// Adds fresh fixtures only; never resets existing sessions or attendance.
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseOptions } from '../dist/database/database-options.js';
import {
  ClassSessionSchema,
  type ClassSessionEntity,
} from '../dist/database/entities/class-session.schema.js';
import { devAuthEnabled } from '../dist/dev/dev-auth.js';
import {
  databaseNow,
  materialiseLockedRoster,
} from '../dist/attendance/roster.service.js';

async function main() {
  if (!devAuthEnabled())
    throw new Error(
      'Enable local development authentication before creating test sessions.',
    );
  const database = await new DataSource(databaseOptions()).initialize();
  try {
    const result = await database.transaction(async (manager) => {
      const [offering] = await manager.query(
        `SELECT c.id FROM classes c
        JOIN enrolments e ON e.class_id = c.id JOIN users u ON u.id = e.student_id
        WHERE u.email = ? AND u.role = 'student' AND u.status = 'active'
        ORDER BY c.id LIMIT 1`,
        ['student.one@example.com'],
      );
      if (!offering)
        throw new Error(
          'Seed the demo student and enrolments with npm run db:seed first.',
        );
      const [classroom] = await manager.query(
        'SELECT * FROM classes WHERE id = ? FOR UPDATE',
        [offering.id],
      );
      const now = await databaseNow(manager);
      const minute = 60000;
      const sessions: Array<{
        scenario: string;
        id: number;
        late_after: string;
        ends_at: string;
      }> = [];
      for (const scenario of ['present', 'late']) {
        const session = (await manager.getRepository(ClassSessionSchema).save({
          class_id: classroom.id,
          starts_at: new Date(
            +now - (scenario === 'present' ? 1 : 30) * minute,
          ),
          late_after: new Date(
            +now + (scenario === 'present' ? 120 : -15) * minute,
          ),
          ends_at: new Date(+now + 240 * minute),
          state: 'scheduled',
          room_label: `DEV ${scenario.toUpperCase()} check-in (synthetic location)`,
          latitude: '0.000000',
          longitude: '0.000000',
          radius_m: '100.00',
        })) as ClassSessionEntity;
        await materialiseLockedRoster(manager, session, now);
        sessions.push({
          scenario,
          id: session.id,
          late_after: session.late_after.toISOString(),
          ends_at: session.ends_at.toISOString(),
        });
      }
      return sessions;
    });
    console.log(JSON.stringify({ created: result }, null, 2));
  } finally {
    await database.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
