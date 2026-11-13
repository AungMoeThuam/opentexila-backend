import { validationError, type ErrorFields } from '../common/api-exception';
import {
  MALAYSIA_OFFSET_HOURS,
  malaysiaDayStart,
  parseMalaysiaDay,
} from '../common/malaysia-day';

export { MALAYSIA_OFFSET_HOURS };

export const DEFAULT_AT_RISK_BELOW = 75;
const MAX_AT_RISK_BELOW = 100;
const MAX_CLASS_ID = 4294967295;

export interface AnalyticsQuery {
  classId?: number;
  from: string;
  to: string;
  // Session start range as UTC instants: fromUtc <= starts_at < toUtcExclusive.
  fromUtc: Date;
  toUtcExclusive: Date;
  atRiskBelow: number;
}

export function parseAnalyticsQuery(
  query: Record<string, unknown>,
): AnalyticsQuery {
  const fields: ErrorFields = {};
  const fail = (name: string, message: string) => {
    fields[name] ??= message;
  };

  let classId: number | undefined;
  if (query.classId !== undefined) {
    const raw = query.classId;
    if (
      typeof raw === 'string' &&
      /^[1-9]\d*$/.test(raw) &&
      Number(raw) <= MAX_CLASS_ID
    )
      classId = Number(raw);
    else fail('classId', `Must be an integer between 1 and ${MAX_CLASS_ID}.`);
  }

  const dayField = (name: 'from' | 'to') => {
    const day = parseMalaysiaDay(query[name]);
    if (day === undefined)
      fail(
        name,
        query[name] === undefined
          ? `${name} is required.`
          : `${name} must be a date in YYYY-MM-DD format.`,
      );
    return day;
  };
  const from = dayField('from');
  const to = dayField('to');
  if (from !== undefined && to !== undefined && from > to)
    fail('from', 'From must not be after To.');

  let atRiskBelow = DEFAULT_AT_RISK_BELOW;
  if (query.atRiskBelow !== undefined) {
    const raw = query.atRiskBelow;
    if (
      typeof raw === 'string' &&
      /^\d{1,3}$/.test(raw) &&
      Number(raw) >= DEFAULT_AT_RISK_BELOW &&
      Number(raw) <= MAX_AT_RISK_BELOW
    )
      atRiskBelow = Number(raw);
    else
      fail(
        'atRiskBelow',
        `Must be a whole number between ${DEFAULT_AT_RISK_BELOW} and ${MAX_AT_RISK_BELOW}.`,
      );
  }

  if (Object.keys(fields).length > 0) throw validationError(fields);
  return {
    classId,
    from: query.from as string,
    to: query.to as string,
    fromUtc: malaysiaDayStart(from as number),
    toUtcExclusive: malaysiaDayStart(to as number, 1),
    atRiskBelow,
  };
}

// Rows from the database. MySQL returns SUM() as strings, hence Number().
export interface SessionRow {
  class_session_id: number;
  class_id: number;
  day: string;
  starts_at: Date;
  ends_at: Date;
  course_code: string;
  course_name: string;
  section: string;
  term: string;
  present: number | string;
  late: number | string;
  absent: number | string;
  pending: number | string;
}

export interface StudentRow {
  class_id: number;
  student_id: number;
  name: string;
  email: string;
  sessions: number | string;
  present: number | string;
  late: number | string;
  absent: number | string;
}

// (present + late) / (present + late + absent) as 0-100 with one decimal.
export function attendanceRate(
  present: number,
  late: number,
  absent: number,
): number {
  const total = present + late + absent;
  return total === 0 ? 0 : Math.round((1000 * (present + late)) / total) / 10;
}

interface Counts {
  present: number;
  late: number;
  absent: number;
}

const emptyCounts = (): Counts => ({ present: 0, late: 0, absent: 0 });

function addTo(target: Counts, row: Counts): void {
  target.present += row.present;
  target.late += row.late;
  target.absent += row.absent;
}

const countsOf = (row: SessionRow | StudentRow): Counts => ({
  present: Number(row.present),
  late: Number(row.late),
  absent: Number(row.absent),
});

export function buildAnalytics(
  query: AnalyticsQuery,
  sessions: SessionRow[],
  students: StudentRow[],
) {
  // Only Finalised class sessions count: none of their records is pending.
  const finalised = sessions.filter((row) => Number(row.pending) === 0);
  const unfinalised = sessions.filter((row) => Number(row.pending) > 0);

  const total = emptyCounts();
  const trend = new Map<string, Counts>();
  const classes = new Map<number, SessionRow & Counts>();
  for (const row of finalised) {
    const counts = countsOf(row);
    addTo(total, counts);
    if (!trend.has(row.day)) trend.set(row.day, emptyCounts());
    addTo(trend.get(row.day) as Counts, counts);
    if (!classes.has(row.class_id))
      classes.set(row.class_id, { ...row, ...emptyCounts() });
    addTo(classes.get(row.class_id) as Counts, counts);
  }
  // A class with only unfinalised sessions still needs a label.
  for (const row of unfinalised)
    if (!classes.has(row.class_id))
      classes.set(row.class_id, { ...row, ...emptyCounts() });

  // Judged on the rate as shown (one decimal), per student per class.
  const atRisk = students
    .map((row) => {
      const counts = countsOf(row);
      return {
        studentId: row.student_id,
        name: row.name,
        email: row.email,
        classId: row.class_id,
        sessions: Number(row.sessions),
        ...counts,
        attendanceRate: attendanceRate(
          counts.present,
          counts.late,
          counts.absent,
        ),
      };
    })
    .filter((row) => row.attendanceRate < query.atRiskBelow)
    .sort(
      (a, b) =>
        a.attendanceRate - b.attendanceRate ||
        a.name.localeCompare(b.name) ||
        a.classId - b.classId ||
        a.studentId - b.studentId,
    );

  return {
    data: {
      summary: {
        sessions: finalised.length,
        ...total,
        attendanceRate: attendanceRate(total.present, total.late, total.absent),
        atRiskCount: atRisk.length,
        unfinalisedSessions: unfinalised.length,
      },
      trend: [...trend]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, counts]) => ({ date, ...counts })),
      byClass: [...classes.values()]
        .sort((a, b) => a.class_id - b.class_id)
        .map((row) => ({
          classId: row.class_id,
          course: { code: row.course_code, name: row.course_name },
          section: row.section,
          term: row.term,
          present: row.present,
          late: row.late,
          absent: row.absent,
          attendanceRate: attendanceRate(row.present, row.late, row.absent),
        })),
      atRisk,
      unfinalised: unfinalised
        .sort(
          (a, b) =>
            a.starts_at.getTime() - b.starts_at.getTime() ||
            a.class_session_id - b.class_session_id,
        )
        .map((row) => ({
          classSessionId: row.class_session_id,
          classId: row.class_id,
          date: row.day,
          startsAt: row.starts_at.toISOString(),
          endsAt: row.ends_at.toISOString(),
          pendingCount: Number(row.pending),
        })),
    },
    meta: { from: query.from, to: query.to, atRiskBelow: query.atRiskBelow },
  };
}
