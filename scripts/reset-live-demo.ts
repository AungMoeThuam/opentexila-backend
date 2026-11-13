import {
  liveSession,
  LIVE_CLASS_KEY,
} from '../database/seeds/production-data.ts';

// Resets the live check-in demo: every student of the live class goes back to
// "pending", and the always-open session is moved so it starts now and stays
// open for 75 days. Run it before a demo, as often as you like.
// It only touches the class DEMO101-A (the live demo class).
(async () => {
  const { AppDataSource } = await import('../dist/database/data-source.js');
  try {
    await AppDataSource.initialize();
    const [classroom] = await AppDataSource.query(
      `SELECT c.id FROM classes c JOIN courses k ON k.id = c.course_id
       WHERE k.code = ? AND c.section = 'A'`,
      [LIVE_CLASS_KEY.split('-')[0]],
    );
    if (!classroom)
      throw new Error('The live demo class (DEMO101-A) does not exist.');
    const window = liveSession(new Date(), []);
    const result = await AppDataSource.transaction(async (manager) => {
      const [session] = await manager.query(
        `SELECT id FROM class_sessions WHERE class_id = ? ORDER BY id LIMIT 1`,
        [classroom.id],
      );
      if (!session) throw new Error('The live demo session does not exist.');
      await manager.query(
        `UPDATE class_sessions SET starts_at = ?, late_after = ?, ends_at = ?, state = 'scheduled' WHERE id = ?`,
        [window.starts_at, window.late_after, window.ends_at, session.id],
      );
      const reset = await manager.query(
        `UPDATE attendance_records SET status = 'pending', checked_in_at = NULL, distance_m = NULL
         WHERE class_session_id = ?`,
        [session.id],
      );
      return {
        class_session_id: session.id,
        students_reset: reset.affectedRows,
      };
    });
    console.log(
      JSON.stringify({ ...result, open_until: window.ends_at }, null, 2),
    );
  } finally {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
})().catch((error: unknown) => {
  console.error(
    'Reset failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
