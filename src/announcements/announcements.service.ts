import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import type { AnnouncementCategory } from '../database/entities';
import type { AuthenticatedUser } from '../auth/auth-request';
import { notFound } from '../common/api-exception';
import { pageMeta, type PageMeta } from '../common/query-reader';
import {
  toClassSummary,
  type ClassSummaryDto,
} from '../attendance/class-summary';
import { likePattern } from '../courses/courses.service';
import { AnnouncementAccessService } from './announcement-access.service';
import type {
  AnnouncementSort,
  ListAllAnnouncementsQueryDto,
  ListAnnouncementsQueryDto,
} from './dto/announcement.dto';

export interface AnnouncementDto {
  id: number;
  class_id: number;
  category: AnnouncementCategory;
  title: string;
  body: string;
  author: { id: number; name: string };
  created_at: string;
  updated_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  // Which class the post belongs to, so a list across classes can label it.
  class: {
    id: number;
    course: { id: number; code: string; name: string };
    section: string;
    term: string;
  };
}

interface AnnouncementRow {
  id: number | string;
  class_id: number | string;
  category: AnnouncementCategory;
  title: string;
  body: string;
  created_at: Date | string;
  updated_at: Date | string;
  author_id: number | string;
  author_name: string;
  course_id: number | string;
  course_code: string;
  course_name: string;
  section: string;
  term: string;
  like_count: number | string;
  comment_count: number | string;
  liked_by_me: number | string | boolean;
}

// Counts and "liked by me" come from the like and comment tables in the same
// query, so a page of posts needs one round trip, not one per post.
const SELECT = `SELECT a.id, a.class_id, a.category, a.title, a.body, a.created_at, a.updated_at,
  u.id AS author_id, u.name AS author_name,
  co.id AS course_id, co.code AS course_code, co.name AS course_name, cl.section, cl.term,
  (SELECT COUNT(*) FROM announcement_likes l WHERE l.announcement_id = a.id) AS like_count,
  (SELECT COUNT(*) FROM announcement_comments c WHERE c.announcement_id = a.id) AS comment_count,
  EXISTS(SELECT 1 FROM announcement_likes m WHERE m.announcement_id = a.id AND m.user_id = ?) AS liked_by_me
  FROM announcements a JOIN users u ON u.id = a.author_id
  JOIN classes cl ON cl.id = a.class_id JOIN courses co ON co.id = cl.course_id`;

// Fixed text only; the sort value never reaches the SQL string.
const ORDER_BY: Record<AnnouncementSort, string> = {
  newest: 'a.created_at DESC, a.id DESC',
  oldest: 'a.created_at ASC, a.id ASC',
  most_liked: 'like_count DESC, a.created_at DESC, a.id DESC',
};

const iso = (value: Date | string): string => new Date(value).toISOString();

function toAnnouncement(
  row: AnnouncementRow,
  user: AuthenticatedUser,
): AnnouncementDto {
  return {
    id: Number(row.id),
    class_id: Number(row.class_id),
    category: row.category,
    title: row.title,
    body: row.body,
    author: { id: Number(row.author_id), name: row.author_name },
    class: {
      id: Number(row.class_id),
      course: {
        id: Number(row.course_id),
        code: row.course_code,
        name: row.course_name,
      },
      section: row.section,
      term: row.term,
    },
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    like_count: Number(row.like_count),
    comment_count: Number(row.comment_count),
    // Admins cannot like, so they never have a like of their own.
    liked_by_me: user.role !== 'admin' && Number(row.liked_by_me) === 1,
  };
}

@Injectable()
export class AnnouncementsService {
  constructor(
    @Inject(DATABASE) private readonly database: DataSource,
    private readonly access: AnnouncementAccessService,
  ) {}

  // One class: the caller must be allowed to see it. Also returns the class
  // summary, so the page can say which class the feed belongs to.
  async list(
    user: AuthenticatedUser,
    classId: number,
    query: ListAnnouncementsQueryDto,
  ): Promise<{
    data: AnnouncementDto[];
    context: { class: ClassSummaryDto };
    meta: PageMeta;
  }> {
    const classroom = await this.access.findVisibleClass(user, classId);
    if (!classroom) throw notFound('Class not found.');
    const page = await this.findPage(user, 'a.class_id = ?', [classId], query);
    return { ...page, context: { class: toClassSummary(classroom) } };
  }

  // Every class the caller may see: enrolled classes for a student, taught
  // classes for a lecturer, all classes for an admin. `classId` narrows it to
  // one class, and a class the caller may not see is a 404, as above.
  async listAll(
    user: AuthenticatedUser,
    query: ListAllAnnouncementsQueryDto,
  ): Promise<{ data: AnnouncementDto[]; meta: PageMeta }> {
    const scope = this.access.scopeCondition(user);
    let where = scope.sql;
    const params = [...scope.params];
    if (query.classId !== undefined) {
      if (!(await this.access.canSeeClass(user, query.classId)))
        throw notFound('Class not found.');
      where += ' AND a.class_id = ?';
      params.push(query.classId);
    }
    return this.findPage(user, where, params, query);
  }

  // Shared by both lists: the base condition, then category and search, with
  // counts, "liked by me", sort and paging in the same queries.
  private async findPage(
    user: AuthenticatedUser,
    baseWhere: string,
    baseParams: unknown[],
    query: ListAnnouncementsQueryDto,
  ): Promise<{ data: AnnouncementDto[]; meta: PageMeta }> {
    const conditions = [baseWhere];
    const params: unknown[] = [...baseParams];
    if (query.category !== undefined) {
      conditions.push('a.category = ?');
      params.push(query.category);
    }
    if (query.search !== undefined) {
      conditions.push('(a.title LIKE ? OR a.body LIKE ?)');
      const pattern = likePattern(query.search);
      params.push(pattern, pattern);
    }
    const where = conditions.join(' AND ');
    const counted = (await this.database.query(
      `SELECT COUNT(*) AS total FROM announcements a WHERE ${where}`,
      params,
    )) as { total: number | string }[];
    const total = Number(counted[0]?.total ?? 0);
    const rows = (await this.database.query(
      `${SELECT} WHERE ${where} ORDER BY ${ORDER_BY[query.sort]} LIMIT ? OFFSET ?`,
      [user.id, ...params, query.limit, (query.page - 1) * query.limit],
    )) as AnnouncementRow[];
    return {
      data: rows.map((row) => toAnnouncement(row, user)),
      meta: pageMeta(query.page, query.limit, total),
    };
  }

  async get(
    user: AuthenticatedUser,
    announcementId: number,
  ): Promise<{ data: AnnouncementDto }> {
    const rows = (await this.database.query(`${SELECT} WHERE a.id = ?`, [
      user.id,
      announcementId,
    ])) as AnnouncementRow[];
    const row = rows[0];
    // A post in a class the user cannot see looks the same as a missing post.
    if (!row || !(await this.access.canSeeClass(user, Number(row.class_id))))
      throw notFound('Announcement not found.');
    return { data: toAnnouncement(row, user) };
  }
}
