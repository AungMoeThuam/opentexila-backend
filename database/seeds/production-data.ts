// Data for the hosted demo ("production" seed). This file only builds plain
// objects from a clock value. It does not touch the database, so tests can
// check the numbers without MySQL.
//
// The sizes are chosen so that the main lists have 2 or 3 pages (page size 20),
// which means 21 to 60 rows. See docs/PRODUCTION_DEMO_ACCOUNTS.md.

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const MINUTE_MS = 60000;

export const PAGE_SIZE = 20;
export const MIN_ROWS = PAGE_SIZE + 1;
export const MAX_ROWS = PAGE_SIZE * 3;

export const EMAIL_DOMAIN = 'example.com';
export const DEFAULT_PASSWORD = 'opentexila-demo-password';

export const LECTURER_COUNT = 8;
export const STUDENT_COUNT = 50;
export const PAST_WEEKS = 8;
export const UPCOMING_WEEKS = 4;
// Classes in the later term start this many weeks from now.
const NEXT_TERM_START_WEEK = 12;

export const TERM_NOW = '2026-S2';
export const TERM_NEXT = '2027-S1';

export interface UserSeed {
  name: string;
  email: string;
  role: 'admin' | 'lecturer' | 'student';
}

export interface CourseSeed {
  code: string;
  name: string;
}

export interface ClassSeed {
  key: string;
  courseCode: string;
  section: string;
  term: string;
  lecturerEmail: string;
  room_label: string;
  latitude: string;
  longitude: string;
  radius_m: string;
  studentEmails: string[];
  live: boolean;
}

export interface RecordSeed {
  studentEmail: string;
  status: 'pending' | 'present' | 'late' | 'absent';
  checked_in_at: Date | null;
  distance_m: string | null;
}

export interface SessionSeed {
  classKey: string;
  starts_at: Date;
  late_after: Date;
  ends_at: Date;
  state: 'scheduled' | 'cancelled';
  records: RecordSeed[];
}

export interface AnnouncementSeed {
  classKey: string;
  category: 'general' | 'class_change' | 'reminder' | 'exam';
  title: string;
  body: string;
  created_at: Date;
  likerEmails: string[];
  commenterEmail: string | null;
  comment: string;
}

export interface ProductionPlan {
  users: UserSeed[];
  courses: CourseSeed[];
  classes: ClassSeed[];
  sessions: SessionSeed[];
  announcements: AnnouncementSeed[];
}

// -- names -------------------------------------------------------------------

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty'];

// 1 -> "one", 21 -> "twenty-one", 50 -> "fifty".
export function numberWord(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 59)
    throw new Error(`numberWord supports 1 to 59, got ${n}`);
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  return n % 10 === 0 ? tens : `${tens}-${ONES[n % 10]}`;
}

function titleCase(word: string): string {
  return word
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

export function accountEmail(role: 'lecturer' | 'student', n: number): string {
  return `${role}-${numberWord(n)}@${EMAIL_DOMAIN}`;
}

export const ADMIN_EMAIL = `admin@${EMAIL_DOMAIN}`;

// -- small helpers -----------------------------------------------------------

// A seeded random number generator, so the same clock gives the same data.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mondayOf(now: Date): number {
  const midnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const weekday = (now.getUTCDay() + 6) % 7; // Monday is 0
  return midnight - weekday * DAY_MS;
}

// -- fixed lists -------------------------------------------------------------

export const COURSES: CourseSeed[] = [
  { code: 'COS30043', name: 'Interface Design and Development' },
  { code: 'COS20007', name: 'Object Oriented Programming' },
  { code: 'COS10009', name: 'Introduction to Programming' },
  { code: 'COS20031', name: 'Database Design and Development' },
  { code: 'COS20019', name: 'Cloud Computing Architecture' },
  { code: 'COS30019', name: 'Introduction to Artificial Intelligence' },
  { code: 'COS30015', name: 'IT Security' },
  { code: 'COS10004', name: 'Computer Systems' },
];

export const LIVE_COURSE: CourseSeed = {
  code: 'DEMO101',
  name: 'Live Check-in Demo',
};

const SECTIONS = ['A', 'B', 'C'];
const CLASS_COUNT = COURSES.length * SECTIONS.length; // 24
// Classes that run twice a week, and classes with about 28 students.
const TWICE_WEEKLY = [4, 13];
const LARGE = [0, 9, 18];
const LARGE_SIZE = 28;
const TWICE_SIZE = 7;
const NEXT_TERM_FROM = 21;

// A venue near the Hawthorn campus. Rooms differ only by a few metres.
const VENUE = { latitude: -37.822, longitude: 145.0388 };
const ROOM_PREFIX = ['ATC', 'EN', 'BA', 'AD'];

function lecturerOf(classIndex: number): number {
  return ((classIndex + Math.floor(classIndex / 8)) % LECTURER_COUNT) + 1;
}

function classKey(classIndex: number): string {
  const course = COURSES[classIndex % COURSES.length];
  return `${course.code}-${SECTIONS[Math.floor(classIndex / COURSES.length)]}`;
}

export const LIVE_CLASS_KEY = `${LIVE_COURSE.code}-A`;
export const LIVE_STUDENT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
// A venue that every place on Earth is inside: half of the Earth's
// circumference is about 20,015,000 m, measured from latitude 0, longitude 0.
export const LIVE_RADIUS_M = '20100000.00';

// -- enrolments --------------------------------------------------------------

// Each student is in 3 or 4 classes, or 3 when the class meets twice a week.
function enrol(): Map<number, number[]> {
  const sizes = new Map<number, number>();
  for (let i = 0; i < CLASS_COUNT; i += 1) {
    if (TWICE_WEEKLY.includes(i)) sizes.set(i, TWICE_SIZE);
    else if (LARGE.includes(i)) sizes.set(i, LARGE_SIZE);
  }
  const regular = [...Array(CLASS_COUNT).keys()].filter((i) => !sizes.has(i));
  regular.forEach((i, slot) => sizes.set(i, slot < 6 ? 5 : 4));

  const count = new Array<number>(STUDENT_COUNT + 1).fill(0);
  const cap = new Array<number>(STUDENT_COUNT + 1).fill(4);
  const members = new Map<number, number[]>();

  // Twice-weekly classes go first, with students 1 to 14, who then stop at 3.
  TWICE_WEEKLY.forEach((classIndex, slot) => {
    const ids = Array.from(
      { length: TWICE_SIZE },
      (_, k) => slot * TWICE_SIZE + k + 1,
    );
    for (const id of ids) {
      count[id] += 1;
      cap[id] = 3;
    }
    members.set(classIndex, ids);
  });

  const order = [...LARGE, ...regular];
  for (const classIndex of order) {
    const need = sizes.get(classIndex) as number;
    const pool = [...Array(STUDENT_COUNT).keys()]
      .map((k) => k + 1)
      .filter((id) => count[id] < cap[id])
      // Fewest classes first, then a rotation by class so the same students
      // are not always chosen together.
      .sort(
        (a, b) =>
          count[a] - count[b] ||
          ((a + classIndex * 7) % STUDENT_COUNT) -
            ((b + classIndex * 7) % STUDENT_COUNT),
      );
    const picked = pool.slice(0, need);
    if (picked.length < need)
      throw new Error('Not enough student capacity for the enrolment plan.');
    for (const id of picked) count[id] += 1;
    members.set(
      classIndex,
      picked.sort((a, b) => a - b),
    );
  }
  return members;
}

// -- the plan ----------------------------------------------------------------

const ANNOUNCEMENT_TEXT: {
  category: AnnouncementSeed['category'];
  title: string;
  body: (code: string) => string;
}[] = [
  {
    category: 'general',
    title: 'Welcome to the unit',
    body: (code) =>
      `Welcome to ${code}. Please read the unit outline before the first class and bring your questions.`,
  },
  {
    category: 'reminder',
    title: 'Check-in reminder',
    body: () =>
      'Attendance uses your location. Turn on location access in your browser and check in when you arrive in the room.',
  },
  {
    category: 'class_change',
    title: 'Room change this week',
    body: (code) =>
      `This week's ${code} class moves to the lab next door. Check-in works in the same way.`,
  },
  {
    category: 'exam',
    title: 'Quiz next week',
    body: (code) =>
      `There will be a short quiz in ${code} next week. It covers the first four weeks.`,
  },
];

export function buildProductionPlan(now: Date = new Date()): ProductionPlan {
  const users: UserSeed[] = [
    { name: 'Admin', email: ADMIN_EMAIL, role: 'admin' },
  ];
  for (let n = 1; n <= LECTURER_COUNT; n += 1)
    users.push({
      name: `Lecturer ${titleCase(numberWord(n))}`,
      email: accountEmail('lecturer', n),
      role: 'lecturer',
    });
  for (let n = 1; n <= STUDENT_COUNT; n += 1)
    users.push({
      name: `Student ${titleCase(numberWord(n))}`,
      email: accountEmail('student', n),
      role: 'student',
    });

  const members = enrol();
  const rankByLecturer = new Map<number, number>();
  const classes: ClassSeed[] = [];
  const sessions: SessionSeed[] = [];
  const monday = mondayOf(now);

  for (let i = 0; i < CLASS_COUNT; i += 1) {
    const course = COURSES[i % COURSES.length];
    const lecturer = lecturerOf(i);
    const rank = rankByLecturer.get(lecturer) ?? 0;
    rankByLecturer.set(lecturer, rank + 1);
    const key = classKey(i);
    const nextTerm = i >= NEXT_TERM_FROM;
    const studentEmails = (members.get(i) as number[]).map((n) =>
      accountEmail('student', n),
    );
    classes.push({
      key,
      courseCode: course.code,
      section: SECTIONS[Math.floor(i / COURSES.length)],
      term: nextTerm ? TERM_NEXT : TERM_NOW,
      lecturerEmail: accountEmail('lecturer', lecturer),
      room_label: `${ROOM_PREFIX[i % ROOM_PREFIX.length]} ${101 + (i % 9)}`,
      latitude: (VENUE.latitude + (i % 5) * 0.00004).toFixed(6),
      longitude: (VENUE.longitude + (i % 4) * 0.00004).toFixed(6),
      radius_m: '100.00',
      studentEmails,
      live: false,
    });

    // One lecturer's classes never overlap: they share a weekday and start at
    // 00:00, 03:00 and 06:00 UTC. A twice-weekly class also meets two days later.
    const weekday = (lecturer - 1) % 5;
    const days = TWICE_WEEKLY.includes(i)
      ? [weekday, (weekday + 2) % 5]
      : [weekday];
    const firstWeek = nextTerm ? NEXT_TERM_START_WEEK : -PAST_WEEKS;
    const lastWeek = nextTerm
      ? NEXT_TERM_START_WEEK + PAST_WEEKS + UPCOMING_WEEKS
      : UPCOMING_WEEKS;
    const cancelWeek = !nextTerm && i % 5 === 2 ? 2 : null;
    const random = mulberry32(1000 + i);

    for (let week = firstWeek; week <= lastWeek; week += 1) {
      for (const day of days) {
        const starts = new Date(
          monday + week * 7 * DAY_MS + day * DAY_MS + rank * 3 * HOUR_MS,
        );
        const ends = new Date(+starts + 2 * HOUR_MS);
        const late = new Date(+starts + 15 * MINUTE_MS);
        const cancelled = cancelWeek === week;
        const finished = +ends <= +now;
        const records: RecordSeed[] = cancelled
          ? []
          : studentEmails.map((studentEmail) => {
              if (!finished)
                return {
                  studentEmail,
                  status: 'pending',
                  checked_in_at: null,
                  distance_m: null,
                };
              const roll = random();
              if (roll < 0.76)
                return {
                  studentEmail,
                  status: 'present',
                  checked_in_at: new Date(
                    +starts + (1 + Math.floor(random() * 14)) * MINUTE_MS,
                  ),
                  distance_m: (2 + random() * 68).toFixed(2),
                };
              if (roll < 0.88)
                return {
                  studentEmail,
                  status: 'late',
                  checked_in_at: new Date(
                    +starts + (16 + Math.floor(random() * 60)) * MINUTE_MS,
                  ),
                  distance_m: (2 + random() * 68).toFixed(2),
                };
              return {
                studentEmail,
                status: 'absent',
                checked_in_at: null,
                distance_m: null,
              };
            });
        sessions.push({
          classKey: key,
          starts_at: starts,
          late_after: late,
          ends_at: ends,
          state: cancelled ? 'cancelled' : 'scheduled',
          records,
        });
      }
    }
  }

  // The live check-in class: one session that stays open for the whole demo,
  // in a venue that every place on Earth is inside.
  const liveStudents = LIVE_STUDENT_NUMBERS.map((n) =>
    accountEmail('student', n),
  );
  classes.push({
    key: LIVE_CLASS_KEY,
    courseCode: LIVE_COURSE.code,
    section: 'A',
    term: TERM_NOW,
    lecturerEmail: accountEmail('lecturer', 1),
    room_label: 'Anywhere (live demo)',
    latitude: '0.000000',
    longitude: '0.000000',
    radius_m: LIVE_RADIUS_M,
    studentEmails: liveStudents,
    live: true,
  });
  sessions.push(liveSession(now, liveStudents));

  return {
    users,
    courses: [...COURSES, LIVE_COURSE],
    classes,
    sessions,
    announcements: buildAnnouncements(classes, now),
  };
}

// The always-open session. `students` all start as pending.
export function liveSession(now: Date, students: string[]): SessionSeed {
  const starts = new Date(Math.floor((+now - HOUR_MS) / MINUTE_MS) * MINUTE_MS);
  const ends = new Date(+starts + 75 * DAY_MS);
  return {
    classKey: LIVE_CLASS_KEY,
    starts_at: starts,
    // Present until one day before the end, so a check-in is Present.
    late_after: new Date(+ends - DAY_MS),
    ends_at: ends,
    state: 'scheduled',
    records: students.map((studentEmail) => ({
      studentEmail,
      status: 'pending',
      checked_in_at: null,
      distance_m: null,
    })),
  };
}

function buildAnnouncements(
  classes: ClassSeed[],
  now: Date,
): AnnouncementSeed[] {
  const list: AnnouncementSeed[] = [];
  const posting = classes.filter((c) => !c.live && c.term === TERM_NOW);
  // 9 classes post twice and 12 post once, which is 30 posts.
  posting.forEach((classroom, index) => {
    const posts = index < 9 ? 2 : 1;
    for (let p = 0; p < posts; p += 1) {
      const text =
        ANNOUNCEMENT_TEXT[(index + p * 2) % ANNOUNCEMENT_TEXT.length];
      const ago = (index * 2 + p * 9 + 1) * DAY_MS;
      list.push({
        classKey: classroom.key,
        category: text.category,
        title: text.title,
        body: text.body(classroom.courseCode),
        created_at: new Date(+now - ago),
        likerEmails: classroom.studentEmails.slice(0, 1 + (index % 3)),
        commenterEmail: classroom.studentEmails[0] ?? null,
        comment: p === 0 ? 'Thanks for letting us know.' : 'Thank you.',
      });
    }
  });
  return list;
}

// -- checks ------------------------------------------------------------------

export interface PlanCounts {
  users: number;
  classes: number;
  sessions: number;
  enrolments: number;
  records: number;
  announcements: number;
  adminListPages: Record<string, number>;
}

function pages(rows: number): number {
  return Math.ceil(rows / PAGE_SIZE);
}

// Returns problems. An empty list means every checked list has 2 or 3 pages.
export function checkPlan(plan: ProductionPlan): {
  counts: PlanCounts;
  problems: string[];
} {
  const problems: string[] = [];
  const inRange = (label: string, rows: number) => {
    if (rows < MIN_ROWS || rows > MAX_ROWS)
      problems.push(
        `${label}: ${rows} rows; the range is ${MIN_ROWS} to ${MAX_ROWS}`,
      );
  };
  const live = (key: string) => key === LIVE_CLASS_KEY;
  const regularClasses = plan.classes.filter((c) => !live(c.key));
  const enrolments = plan.classes.reduce(
    (n, c) => n + c.studentEmails.length,
    0,
  );
  const records = plan.sessions.reduce((n, s) => n + s.records.length, 0);

  inRange('classes', plan.classes.length);
  inRange('users', plan.users.length);
  inRange('announcements', plan.announcements.length);

  // Per class: sessions and the records of the large classes.
  const sessionsOf = (key: string) =>
    plan.sessions.filter((s) => s.classKey === key);
  for (const classroom of regularClasses) {
    if (classroom.studentEmails.length > 30)
      problems.push(`${classroom.key}: more than 30 students`);
  }

  // Per person: sessions the lecturer or the student sees.
  const lecturers = plan.users.filter((u) => u.role === 'lecturer');
  for (const lecturer of lecturers) {
    const mine = plan.classes.filter((c) => c.lecturerEmail === lecturer.email);
    const rows = mine.reduce((n, c) => n + sessionsOf(c.key).length, 0);
    inRange(`lecturer sessions (${lecturer.email})`, rows);
  }
  for (const student of plan.users.filter((u) => u.role === 'student')) {
    const mine = plan.classes.filter((c) =>
      c.studentEmails.includes(student.email),
    );
    if (mine.length < 3 && !mine.some((c) => live(c.key)))
      problems.push(`${student.email}: fewer than 3 classes`);
    const regular = mine.filter((c) => !live(c.key));
    if (regular.length < 3 || regular.length > 4)
      problems.push(`${student.email}: ${regular.length} regular classes`);
    inRange(
      `student sessions (${student.email})`,
      mine.reduce((n, c) => n + sessionsOf(c.key).length, 0),
    );
    const history = plan.sessions
      .filter((s) => mine.some((c) => c.key === s.classKey))
      .flatMap((s) => s.records)
      .filter(
        (r) => r.studentEmail === student.email && r.status !== 'pending',
      ).length;
    inRange(`student attendance history (${student.email})`, history);
  }
  for (const key of TWICE_WEEKLY.map(classKey))
    inRange(`sessions of ${key}`, sessionsOf(key).length);
  for (const key of LARGE.map(classKey)) {
    const classroom = plan.classes.find((c) => c.key === key);
    inRange(`students of ${key}`, classroom?.studentEmails.length ?? 0);
  }

  return {
    counts: {
      users: plan.users.length,
      classes: plan.classes.length,
      sessions: plan.sessions.length,
      enrolments,
      records,
      announcements: plan.announcements.length,
      adminListPages: {
        users: pages(plan.users.length),
        classes: pages(plan.classes.length),
      },
    },
    problems,
  };
}
