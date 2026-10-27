const argon2 = require('argon2');

async function seedDemo(dataSource, env = process.env) {
  if (
    env.NODE_ENV !== 'development' ||
    !['127.0.0.1', 'localhost'].includes(env.DB_HOST)
  ) {
    throw new Error(
      'Demo seeds require NODE_ENV=development and a local DB_HOST.',
    );
  }
  if (!env.SEED_PASSWORD || env.SEED_PASSWORD.length < 12)
    throw new Error(
      'Set SEED_PASSWORD to a demo-only password of at least 12 characters.',
    );
  const startsAt = env.SEED_MEETING_START
    ? new Date(env.SEED_MEETING_START)
    : new Date(`${new Date().toISOString().slice(0, 10)}T01:00:00.000Z`);
  if (
    !Number.isFinite(startsAt.getTime()) ||
    (env.SEED_MEETING_START && !env.SEED_MEETING_START.endsWith('Z'))
  ) {
    throw new Error(
      'SEED_MEETING_START must be an ISO 8601 UTC timestamp ending in Z.',
    );
  }
  const previousStart = new Date(startsAt.getTime() - 86400000);
  const passwordHash = await argon2.hash(env.SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  return dataSource.transaction(async (manager) => {
    const accounts = [];
    const fixtures = [
      ['Admin Demo', 'admin.demo@example.com', 'DEMO-ADMIN', 'admin', 'active'],
      [
        'Lecturer Demo',
        'lecturer.demo@example.com',
        'DEMO-TEACHER',
        'teacher',
        'active',
      ],
      [
        'Student One',
        'student.one@example.com',
        'DEMO-STUDENT-1',
        'student',
        'active',
      ],
      [
        'Student Two',
        'student.two@example.com',
        'DEMO-STUDENT-2',
        'student',
        'active',
      ],
      [
        'Non Member',
        'nonmember.demo@example.com',
        'DEMO-NONMEMBER',
        'student',
        'active',
      ],
      [
        'Invited Demo',
        'invited.demo@example.com',
        'DEMO-INVITED',
        'student',
        'invited',
      ],
    ];
    const users = manager.getRepository('User');
    for (const [name, email, institution_member_id, role, status] of fixtures) {
      let user = await users.findOneBy({ email });
      if (
        user &&
        (user.institution_member_id !== institution_member_id ||
          user.role !== role)
      )
        throw new Error(
          `Seed identity conflict for ${email}; existing accounts were not overwritten.`,
        );
      if (!user)
        user = await users.save({
          name,
          email,
          institution_member_id,
          role,
          status,
          password_hash: status === 'active' ? passwordHash : null,
          activated_at: status === 'active' ? new Date() : null,
        });
      accounts.push(user);
    }
    const classrooms = manager.getRepository('Classroom');
    let classroom = await classrooms.findOneBy({
      code: 'COS30043-DEMO',
      term: 'DEMO',
    });
    if (!classroom)
      classroom = await classrooms.save({
        code: 'COS30043-DEMO',
        term: 'DEMO',
        name: 'Interface Design · Demo',
        subject: 'Interface Design and Development',
        teacher_id: accounts[1].id,
        room_label: 'Demo room (synthetic location)',
        latitude: '0.000000',
        longitude: '0.000000',
        radius_m: '100.00',
        max_accuracy_m: '30.00',
      });
    // Keep fixture membership stable on reruns, including withdrawn rows. Never overwrite API work.
    for (const student of accounts.slice(2, 4)) {
      const repo = manager.getRepository('Enrolment');
      if (
        !(await repo.findOneBy({
          classroom_id: classroom.id,
          student_id: student.id,
        }))
      ) {
        await repo.save({
          classroom_id: classroom.id,
          student_id: student.id,
          enrolled_at: new Date(previousStart.getTime() - 86400000),
        });
      }
    }
    const meetings = manager.getRepository('ClassMeeting');
    const schedule = [];
    for (const start of [previousStart, startsAt]) {
      let meeting = await meetings.findOneBy({
        classroom_id: classroom.id,
        starts_at: start,
      });
      if (!meeting)
        meeting = await meetings.save({
          classroom_id: classroom.id,
          starts_at: start,
          late_after: new Date(start.getTime() + 15 * 60000),
          ends_at: new Date(start.getTime() + 2 * 3600000),
          created_by: accounts[0].id,
        });
      schedule.push(meeting);
    }
    // Fixed fictional completed session for history API work. No live attendance is awarded.
    const sessions = manager.getRepository('AttendanceSession');
    let history = await sessions.findOneBy({ meeting_id: schedule[0].id });
    if (!history) {
      const meeting = schedule[0];
      history = await sessions.save({
        meeting_id: meeting.id,
        opens_at: meeting.starts_at,
        late_after: meeting.late_after,
        closes_at: meeting.ends_at,
        closed_at: meeting.ends_at,
        state: 'closed',
        room_label: classroom.room_label,
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        radius_m: classroom.radius_m,
        max_accuracy_m: classroom.max_accuracy_m,
      });
      const at = new Date(previousStart.getTime() + 5 * 60000);
      await manager.getRepository('AttendanceRecord').save([
        {
          session_id: history.id,
          student_id: accounts[2].id,
          status: 'present',
          checked_in_at: at,
          distance_m: '5.00',
          accuracy_m: '10.00',
          location_validated_at: at,
        },
        {
          session_id: history.id,
          student_id: accounts[3].id,
          status: 'absent',
        },
      ]);
    }
    return {
      accounts: accounts.map(({ id, email, role, status }) => ({
        id,
        email,
        role,
        status,
      })),
      classroom_id: classroom.id,
      meeting_ids: schedule.map((m) => m.id),
    };
  });
}

if (require.main === module) {
  const { AppDataSource } = require('../../dist/database/data-source');
  (async () => {
    try {
      await AppDataSource.initialize();
      if (await AppDataSource.showMigrations())
        throw new Error('Run npm run db:migrate before seeding.');
      console.log(JSON.stringify(await seedDemo(AppDataSource), null, 2));
    } finally {
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
  })().catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  });
}
module.exports = { seedDemo };
