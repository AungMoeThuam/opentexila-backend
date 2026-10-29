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
  const passwordHash = await argon2.hash(env.SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const DAY = 86400000;
  const MINUTE = 60000;
  const words = [
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
    'Twenty',
  ];
  // Order matters: accounts[0] admin, [1] first lecturer, [2] and [3] first two students.
  const lecturers = [1, 2, 3, 4].map((n) => [
    `Lecturer ${words[n - 1]}`,
    `lecturer.${words[n - 1].toLowerCase()}@example.com`,
    'teacher',
  ]);
  const students = words.map((word) => [
    `Student ${word}`,
    `student.${word.toLowerCase()}@example.com`,
    'student',
  ]);
  const fixtures = [
    ['Admin Demo', 'admin.demo@example.com', 'admin'],
    lecturers[0],
    students[0],
    students[1],
    ...lecturers.slice(1),
    ...students.slice(2),
    ['Non Member', 'nonmember.demo@example.com', 'student'],
  ];
  // [course code, section, lecturer number, student numbers]
  const range = (from, to) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const classPlans = [
    ['COS30043', 'A', 1, range(1, 8)],
    ['COS30043', 'B', 2, range(9, 14)],
    ['COS20007', 'A', 2, [1, 2, 3, 4, 15, 16]],
    ['COS20007', 'B', 3, range(5, 10)],
    ['COS10009', 'A', 3, range(11, 18)],
    ['COS10009', 'B', 4, [17, 18, 19, 20, 1]],
    ['COS20031', 'A', 4, [1, 2, 19, 20, 5, 6]],
    ['COS20019', 'A', 1, range(3, 10)],
  ];
  const courseNames = {
    COS30043: 'Interface Design and Development',
    COS20007: 'Object Oriented Programming',
    COS10009: 'Introduction to Programming',
    COS20031: 'Database Design and Development',
    COS20019: 'Cloud Computing Architecture',
  };
  // Weekly sessions relative to the base start: five past, one current, two upcoming.
  const weekOffsets = [-5, -4, -3, -2, -1, 0, 1, 2];
  const cancelledOffset = -3;
  return dataSource.transaction(async (manager) => {
    const accounts = [];
    const users = manager.getRepository('User');
    for (const [name, email, role] of fixtures) {
      let user = await users.findOneBy({ email });
      if (user && user.role !== role)
        throw new Error(
          `Seed identity conflict for ${email}; existing accounts were not overwritten.`,
        );
      if (!user)
        user = await users.save({
          name,
          email,
          role,
          status: 'active',
          password_hash: passwordHash,
          must_change_password: false,
        });
      accounts.push(user);
    }
    const byEmail = new Map(accounts.map((u) => [u.email, u]));
    const lecturer = (n) => byEmail.get(lecturers[n - 1][1]);
    const student = (n) => byEmail.get(students[n - 1][1]);

    const courses = manager.getRepository('Course');
    const courseByCode = new Map();
    for (const [code, name] of Object.entries(courseNames)) {
      courseByCode.set(
        code,
        (await courses.findOneBy({ code })) ??
          (await courses.save({ code, name })),
      );
    }

    const classes = manager.getRepository('Class');
    const enrolments = manager.getRepository('Enrolment');
    const classSessions = manager.getRepository('ClassSession');
    const records = manager.getRepository('AttendanceRecord');
    const classIds = [];
    const sessionIds = [];
    let firstClass;
    let firstClassSessions = [];
    for (const [index, plan] of classPlans.entries()) {
      const [code, section, lecturerNo, studentNos] = plan;
      const course = courseByCode.get(code);
      const term = '2026-S2';
      let classroom = await classes.findOneBy({
        course_id: course.id,
        section,
        term,
      });
      if (!classroom)
        classroom = await classes.save({
          course_id: course.id,
          section,
          term,
          teacher_id: lecturer(lecturerNo).id,
          room_label: `Demo room ${index + 1} (synthetic location)`,
          latitude: '0.000000',
          longitude: '0.000000',
          radius_m: '100.00',
        });
      classIds.push(classroom.id);
      // Keep membership stable on reruns. Never overwrite API work.
      for (const no of studentNos) {
        const enrolled = await enrolments.findOneBy({
          class_id: classroom.id,
          student_id: student(no).id,
        });
        if (!enrolled)
          await enrolments.save({
            class_id: classroom.id,
            student_id: student(no).id,
          });
      }
      const enrolledIds = studentNos.map((no) => student(no).id);
      const schedule = [];
      for (const week of weekOffsets) {
        // Classes meet at different hours so timetables differ.
        const start = new Date(
          startsAt.getTime() + week * 7 * DAY + (index % 4) * 3 * 3600000,
        );
        let classSession = await classSessions.findOneBy({
          class_id: classroom.id,
          starts_at: start,
        });
        if (!classSession) {
          classSession = await classSessions.save({
            class_id: classroom.id,
            starts_at: start,
            late_after: new Date(start.getTime() + 15 * MINUTE),
            ends_at: new Date(start.getTime() + 2 * 3600000),
            state:
              week === cancelledOffset && index % 3 === 0
                ? 'cancelled'
                : 'scheduled',
          });
          // Cancelled sessions have no records. Past sessions are finalised;
          // current and upcoming sessions are pending until check-in is built.
          if (classSession.state === 'scheduled') {
            await records.save(
              enrolledIds.map((studentId, i) => {
                if (week >= 0)
                  return {
                    class_session_id: classSession.id,
                    student_id: studentId,
                  };
                const pattern = (i + index + week + 10) % 7;
                if (pattern === 0)
                  return {
                    class_session_id: classSession.id,
                    student_id: studentId,
                    status: 'absent',
                  };
                const late = pattern === 1;
                return {
                  class_session_id: classSession.id,
                  student_id: studentId,
                  status: late ? 'late' : 'present',
                  checked_in_at: new Date(
                    start.getTime() +
                      (late ? 20 : 2 + ((i + index) % 10)) * MINUTE,
                  ),
                  distance_m: `${2 + ((i * 7 + index) % 40)}.00`,
                };
              }),
            );
          }
        }
        schedule.push(classSession);
        sessionIds.push(classSession.id);
      }
      if (index === 0) {
        firstClass = classroom;
        // The week -1 and week 0 sessions: a completed one and the current one.
        firstClassSessions = [schedule[4], schedule[5]];
      }
    }
    return {
      accounts: accounts.map(({ id, email, role, status }) => ({
        id,
        email,
        role,
        status,
      })),
      course_id: courseByCode.get('COS30043').id,
      class_id: firstClass.id,
      class_session_ids: firstClassSessions.map((m) => m.id),
      class_ids: classIds,
      all_class_session_ids: sessionIds,
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
