const argon2 = require('argon2');

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

// Order matters for first four entries:
// [0] admin, [1] Lecturer One, [2] Student One, [3] Student Two.
const USER_FIXTURES = [
  { name: 'Admin Demo', email: 'admin.demo@example.com', role: 'admin' },
  { name: 'Lecturer One', email: 'lecturer.one@example.com', role: 'teacher' },
  { name: 'Student One', email: 'student.one@example.com', role: 'student' },
  { name: 'Student Two', email: 'student.two@example.com', role: 'student' },
  { name: 'Lecturer Two', email: 'lecturer.two@example.com', role: 'teacher' },
  {
    name: 'Lecturer Three',
    email: 'lecturer.three@example.com',
    role: 'teacher',
  },
  {
    name: 'Lecturer Four',
    email: 'lecturer.four@example.com',
    role: 'teacher',
  },
  {
    name: 'Student Three',
    email: 'student.three@example.com',
    role: 'student',
  },
  { name: 'Student Four', email: 'student.four@example.com', role: 'student' },
  { name: 'Student Five', email: 'student.five@example.com', role: 'student' },
  { name: 'Student Six', email: 'student.six@example.com', role: 'student' },
  {
    name: 'Student Seven',
    email: 'student.seven@example.com',
    role: 'student',
  },
  {
    name: 'Student Eight',
    email: 'student.eight@example.com',
    role: 'student',
  },
  { name: 'Student Nine', email: 'student.nine@example.com', role: 'student' },
  { name: 'Student Ten', email: 'student.ten@example.com', role: 'student' },
  {
    name: 'Student Eleven',
    email: 'student.eleven@example.com',
    role: 'student',
  },
  {
    name: 'Student Twelve',
    email: 'student.twelve@example.com',
    role: 'student',
  },
  {
    name: 'Student Thirteen',
    email: 'student.thirteen@example.com',
    role: 'student',
  },
  {
    name: 'Student Fourteen',
    email: 'student.fourteen@example.com',
    role: 'student',
  },
  {
    name: 'Student Fifteen',
    email: 'student.fifteen@example.com',
    role: 'student',
  },
  {
    name: 'Student Sixteen',
    email: 'student.sixteen@example.com',
    role: 'student',
  },
  {
    name: 'Student Seventeen',
    email: 'student.seventeen@example.com',
    role: 'student',
  },
  {
    name: 'Student Eighteen',
    email: 'student.eighteen@example.com',
    role: 'student',
  },
  {
    name: 'Student Nineteen',
    email: 'student.nineteen@example.com',
    role: 'student',
  },
  {
    name: 'Student Twenty',
    email: 'student.twenty@example.com',
    role: 'student',
  },
  { name: 'Non Member', email: 'nonmember.demo@example.com', role: 'student' },
];

const COURSE_FIXTURES = [
  { code: 'COS30043', name: 'Interface Design and Development' },
  { code: 'COS20007', name: 'Object Oriented Programming' },
  { code: 'COS10009', name: 'Introduction to Programming' },
  { code: 'COS20031', name: 'Database Design and Development' },
  { code: 'COS20019', name: 'Cloud Computing Architecture' },
];

const CLASS_FIXTURES = [
  {
    courseCode: 'COS30043',
    section: 'A',
    term: '2026-S2',
    teacherEmail: 'lecturer.one@example.com',
    room_label: 'Demo room 1 (synthetic location)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
    hourOffset: 0,
    cancelledWeeks: [-3],
    studentEmails: [
      'student.one@example.com',
      'student.two@example.com',
      'student.three@example.com',
      'student.four@example.com',
      'student.five@example.com',
      'student.six@example.com',
      'student.seven@example.com',
      'student.eight@example.com',
    ],
  },
  {
    courseCode: 'COS30043',
    section: 'B',
    term: '2026-S2',
    teacherEmail: 'lecturer.two@example.com',
    room_label: 'Demo room 2 (synthetic location)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
    hourOffset: 3,
    cancelledWeeks: [],
    studentEmails: [
      'student.nine@example.com',
      'student.ten@example.com',
      'student.eleven@example.com',
      'student.twelve@example.com',
      'student.thirteen@example.com',
      'student.fourteen@example.com',
    ],
  },
  {
    courseCode: 'COS20007',
    section: 'A',
    term: '2026-S2',
    teacherEmail: 'lecturer.two@example.com',
    room_label: 'Demo room 3 (synthetic location)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
    hourOffset: 6,
    cancelledWeeks: [],
    studentEmails: [
      'student.one@example.com',
      'student.two@example.com',
      'student.three@example.com',
      'student.four@example.com',
      'student.fifteen@example.com',
      'student.sixteen@example.com',
    ],
  },
  {
    courseCode: 'COS20007',
    section: 'B',
    term: '2026-S2',
    teacherEmail: 'lecturer.three@example.com',
    room_label: 'Demo room 4 (synthetic location)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
    hourOffset: 9,
    cancelledWeeks: [-3],
    studentEmails: [
      'student.five@example.com',
      'student.six@example.com',
      'student.seven@example.com',
      'student.eight@example.com',
      'student.nine@example.com',
      'student.ten@example.com',
    ],
  },
  {
    courseCode: 'COS10009',
    section: 'A',
    term: '2026-S2',
    teacherEmail: 'lecturer.three@example.com',
    room_label: 'Demo room 5 (synthetic location)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
    hourOffset: 0,
    cancelledWeeks: [],
    studentEmails: [
      'student.eleven@example.com',
      'student.twelve@example.com',
      'student.thirteen@example.com',
      'student.fourteen@example.com',
      'student.fifteen@example.com',
      'student.sixteen@example.com',
      'student.seventeen@example.com',
      'student.eighteen@example.com',
    ],
  },
  {
    courseCode: 'COS10009',
    section: 'B',
    term: '2026-S2',
    teacherEmail: 'lecturer.four@example.com',
    room_label: 'Demo room 6 (synthetic location)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
    hourOffset: 3,
    cancelledWeeks: [],
    studentEmails: [
      'student.seventeen@example.com',
      'student.eighteen@example.com',
      'student.nineteen@example.com',
      'student.twenty@example.com',
      'student.one@example.com',
    ],
  },
  {
    courseCode: 'COS20031',
    section: 'A',
    term: '2026-S2',
    teacherEmail: 'lecturer.four@example.com',
    room_label: 'Demo room 7 (synthetic location)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
    hourOffset: 6,
    cancelledWeeks: [-3],
    studentEmails: [
      'student.one@example.com',
      'student.two@example.com',
      'student.nineteen@example.com',
      'student.twenty@example.com',
      'student.five@example.com',
      'student.six@example.com',
    ],
  },
  {
    courseCode: 'COS20019',
    section: 'A',
    term: '2026-S2',
    teacherEmail: 'lecturer.one@example.com',
    room_label: 'Demo room 8 (synthetic location)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: '100.00',
    hourOffset: 9,
    cancelledWeeks: [],
    studentEmails: [
      'student.three@example.com',
      'student.four@example.com',
      'student.five@example.com',
      'student.six@example.com',
      'student.seven@example.com',
      'student.eight@example.com',
      'student.nine@example.com',
      'student.ten@example.com',
    ],
  },
];

// Weekly sessions relative to startsAt: five past, one today (0), two upcoming.
const SESSION_WEEK_OFFSETS = [-5, -4, -3, -2, -1, 0, 1, 2];

// Static past-session attendance outcomes per student slot (up to 8 students) for each past week.
const PAST_WEEK_ATTENDANCE = {
  '-5': [
    { status: 'present', checkInMinutes: 3, distance_m: '8.00' },
    { status: 'present', checkInMinutes: 5, distance_m: '12.00' },
    { status: 'late', checkInMinutes: 20, distance_m: '18.00' },
    { status: 'present', checkInMinutes: 4, distance_m: '10.00' },
    { status: 'absent' },
    { status: 'present', checkInMinutes: 6, distance_m: '15.00' },
    { status: 'present', checkInMinutes: 2, distance_m: '5.00' },
    { status: 'present', checkInMinutes: 7, distance_m: '22.00' },
  ],
  '-4': [
    { status: 'present', checkInMinutes: 4, distance_m: '9.00' },
    { status: 'late', checkInMinutes: 19, distance_m: '14.00' },
    { status: 'present', checkInMinutes: 6, distance_m: '11.00' },
    { status: 'absent' },
    { status: 'present', checkInMinutes: 3, distance_m: '7.00' },
    { status: 'present', checkInMinutes: 8, distance_m: '19.00' },
    { status: 'present', checkInMinutes: 5, distance_m: '13.00' },
    { status: 'late', checkInMinutes: 22, distance_m: '25.00' },
  ],
  '-3': [
    { status: 'present', checkInMinutes: 2, distance_m: '6.00' },
    { status: 'present', checkInMinutes: 7, distance_m: '16.00' },
    { status: 'absent' },
    { status: 'present', checkInMinutes: 5, distance_m: '10.00' },
    { status: 'late', checkInMinutes: 18, distance_m: '21.00' },
    { status: 'present', checkInMinutes: 4, distance_m: '9.00' },
    { status: 'present', checkInMinutes: 6, distance_m: '14.00' },
    { status: 'present', checkInMinutes: 3, distance_m: '8.00' },
  ],
  '-2': [
    { status: 'late', checkInMinutes: 21, distance_m: '17.00' },
    { status: 'present', checkInMinutes: 4, distance_m: '11.00' },
    { status: 'present', checkInMinutes: 3, distance_m: '7.00' },
    { status: 'present', checkInMinutes: 6, distance_m: '13.00' },
    { status: 'present', checkInMinutes: 5, distance_m: '12.00' },
    { status: 'absent' },
    { status: 'present', checkInMinutes: 8, distance_m: '20.00' },
    { status: 'present', checkInMinutes: 2, distance_m: '5.00' },
  ],
  '-1': [
    { status: 'present', checkInMinutes: 5, distance_m: '5.00' },
    { status: 'absent' },
    { status: 'present', checkInMinutes: 4, distance_m: '9.00' },
    { status: 'late', checkInMinutes: 20, distance_m: '15.00' },
    { status: 'present', checkInMinutes: 6, distance_m: '11.00' },
    { status: 'present', checkInMinutes: 3, distance_m: '8.00' },
    { status: 'absent' },
    { status: 'present', checkInMinutes: 7, distance_m: '18.00' },
  ],
};

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

  return dataSource.transaction(async (manager) => {
    const accounts = [];
    const users = manager.getRepository('User');
    for (const { name, email, role } of USER_FIXTURES) {
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
    const userByEmail = new Map(accounts.map((u) => [u.email, u]));

    const courses = manager.getRepository('Course');
    const courseByCode = new Map();
    for (const { code, name } of COURSE_FIXTURES) {
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

    for (const [index, plan] of CLASS_FIXTURES.entries()) {
      const course = courseByCode.get(plan.courseCode);
      const teacher = userByEmail.get(plan.teacherEmail);
      let classroom = await classes.findOneBy({
        course_id: course.id,
        section: plan.section,
        term: plan.term,
      });
      if (!classroom)
        classroom = await classes.save({
          course_id: course.id,
          section: plan.section,
          term: plan.term,
          teacher_id: teacher.id,
          room_label: plan.room_label,
          latitude: plan.latitude,
          longitude: plan.longitude,
          radius_m: plan.radius_m,
        });
      classIds.push(classroom.id);

      // Keep membership stable on reruns. Never overwrite API work.
      const enrolledStudents = plan.studentEmails.map((email) =>
        userByEmail.get(email),
      );
      for (const student of enrolledStudents) {
        const enrolled = await enrolments.findOneBy({
          class_id: classroom.id,
          student_id: student.id,
        });
        if (!enrolled)
          await enrolments.save({
            class_id: classroom.id,
            student_id: student.id,
          });
      }

      const schedule = [];
      for (const week of SESSION_WEEK_OFFSETS) {
        const start = new Date(
          startsAt.getTime() + week * 7 * DAY_MS + plan.hourOffset * HOUR_MS,
        );
        let classSession = await classSessions.findOneBy({
          class_id: classroom.id,
          starts_at: start,
        });
        if (!classSession) {
          classSession = await classSessions.save({
            class_id: classroom.id,
            starts_at: start,
            late_after: new Date(start.getTime() + 15 * MINUTE_MS),
            ends_at: new Date(start.getTime() + 2 * HOUR_MS),
            state: plan.cancelledWeeks.includes(week)
              ? 'cancelled'
              : 'scheduled',
          });
          // Cancelled sessions have no records. Past sessions use static outcomes;
          // current and upcoming sessions remain pending.
          if (classSession.state === 'scheduled') {
            const weekOutcomes = PAST_WEEK_ATTENDANCE[String(week)];
            await records.save(
              enrolledStudents.map((student, slot) => {
                if (!weekOutcomes)
                  return {
                    class_session_id: classSession.id,
                    student_id: student.id,
                  };
                const outcome = weekOutcomes[slot];
                if (outcome.status === 'absent')
                  return {
                    class_session_id: classSession.id,
                    student_id: student.id,
                    status: 'absent',
                  };
                return {
                  class_session_id: classSession.id,
                  student_id: student.id,
                  status: outcome.status,
                  checked_in_at: new Date(
                    start.getTime() + outcome.checkInMinutes * MINUTE_MS,
                  ),
                  distance_m: outcome.distance_m,
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
        // Week -1 (completed) and week 0 (today).
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
