import path from 'node:path';
import argon2 from 'argon2';
import type { DataSource } from 'typeorm';
import type {
  UserEntity,
  CourseEntity,
  ClassEntity,
  ClassSessionEntity,
  EnrolmentEntity,
  AttendanceRecordEntity,
  AnnouncementEntity,
  AnnouncementLike,
  AnnouncementComment,
} from '../../dist/database/entities/index.js';
import {
  DEFAULT_PASSWORD,
  buildProductionPlan,
  checkPlan,
} from './production-data.ts';

const HOUR_MS = 3600000;

// Loads the hosted demo data into an EMPTY database. It stops when the users
// table already has rows, so it can never overwrite real work.
export async function seedProduction(
  dataSource: DataSource,
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
) {
  const password = env.SEED_PASSWORD || DEFAULT_PASSWORD;
  if (password.length < 12)
    throw new Error('SEED_PASSWORD must be at least 12 characters.');
  const plan = buildProductionPlan(now);
  const { counts, problems } = checkPlan(plan);
  if (problems.length > 0)
    throw new Error(`The seed plan is invalid:\n- ${problems.join('\n- ')}`);

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  await dataSource.transaction(async (manager) => {
    const users = manager.getRepository<UserEntity>('User');
    if ((await users.count()) > 0)
      throw new Error(
        'The database already has users. The production seed only runs on an empty database.',
      );

    const userByEmail = new Map<string, UserEntity>();
    for (const user of plan.users)
      userByEmail.set(
        user.email,
        await users.save({
          ...user,
          status: 'active',
          password_hash: passwordHash,
          must_change_password: false,
        }),
      );

    const courses = manager.getRepository<CourseEntity>('Course');
    const courseByCode = new Map<string, CourseEntity>();
    for (const course of plan.courses)
      courseByCode.set(course.code, await courses.save(course));

    const classes = manager.getRepository<ClassEntity>('Class');
    const enrolments = manager.getRepository<EnrolmentEntity>('Enrolment');
    const classByKey = new Map<string, ClassEntity>();
    for (const item of plan.classes) {
      const course = courseByCode.get(item.courseCode);
      const lecturer = userByEmail.get(item.lecturerEmail);
      if (!course || !lecturer) throw new Error(`Bad plan for ${item.key}.`);
      const saved = await classes.save({
        course_id: course.id,
        section: item.section,
        term: item.term,
        lecturer_id: lecturer.id,
        room_label: item.room_label,
        latitude: item.latitude,
        longitude: item.longitude,
        radius_m: item.radius_m,
      });
      classByKey.set(item.key, saved);
      await enrolments.insert(
        item.studentEmails.map((email) => ({
          class_id: saved.id,
          student_id: (userByEmail.get(email) as UserEntity).id,
        })),
      );
    }

    const sessions = manager.getRepository<ClassSessionEntity>('ClassSession');
    const records =
      manager.getRepository<AttendanceRecordEntity>('AttendanceRecord');
    let pending: Partial<AttendanceRecordEntity>[] = [];
    const flush = async () => {
      if (pending.length > 0) await records.insert(pending as never);
      pending = [];
    };
    for (const item of plan.sessions) {
      const classroom = classByKey.get(item.classKey) as ClassEntity;
      const saved = await sessions.save({
        class_id: classroom.id,
        room_label: classroom.room_label,
        latitude: classroom.latitude,
        longitude: classroom.longitude,
        radius_m: classroom.radius_m,
        starts_at: item.starts_at,
        late_after: item.late_after,
        ends_at: item.ends_at,
        state: item.state,
      });
      for (const record of item.records)
        pending.push({
          class_session_id: saved.id,
          student_id: (userByEmail.get(record.studentEmail) as UserEntity).id,
          status: record.status,
          checked_in_at: record.checked_in_at,
          distance_m: record.distance_m,
        });
      if (pending.length >= 500) await flush();
    }
    await flush();

    const announcements =
      manager.getRepository<AnnouncementEntity>('Announcement');
    const likes = manager.getRepository<AnnouncementLike>('AnnouncementLike');
    const comments = manager.getRepository<AnnouncementComment>(
      'AnnouncementComment',
    );
    for (const post of plan.announcements) {
      const classroom = classByKey.get(post.classKey) as ClassEntity;
      const lecturer = userByEmail.get(
        plan.classes.find((c) => c.key === post.classKey)
          ?.lecturerEmail as string,
      ) as UserEntity;
      const saved = await announcements.save({
        class_id: classroom.id,
        author_id: lecturer.id,
        category: post.category,
        title: post.title,
        body: post.body,
        created_at: post.created_at,
        updated_at: post.created_at,
      });
      await likes.insert(
        post.likerEmails.map((email) => ({
          announcement_id: saved.id,
          user_id: (userByEmail.get(email) as UserEntity).id,
          created_at: new Date(+post.created_at + HOUR_MS),
        })),
      );
      if (post.commenterEmail)
        await comments.insert({
          announcement_id: saved.id,
          author_id: (userByEmail.get(post.commenterEmail) as UserEntity).id,
          body: post.comment,
          created_at: new Date(+post.created_at + 2 * HOUR_MS),
        });
    }
  });
  return counts;
}

if (
  process.argv[1] &&
  path
    .resolve(process.argv[1])
    .endsWith(path.join('database', 'seeds', 'production.ts'))
) {
  (async () => {
    if (process.argv.includes('--dry-run')) {
      console.log(JSON.stringify(checkPlan(buildProductionPlan()), null, 2));
      return;
    }
    const { AppDataSource } =
      await import('../../dist/database/data-source.js');
    try {
      await AppDataSource.initialize();
      if (await AppDataSource.showMigrations())
        throw new Error('Run npm run db:migrate before seeding.');
      console.log(JSON.stringify(await seedProduction(AppDataSource), null, 2));
    } finally {
      if (AppDataSource.isInitialized) await AppDataSource.destroy();
    }
  })().catch((error: unknown) => {
    console.error(
      'Seed failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
