import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import type { UserRole } from '../database/entities';
import type { AuthenticatedUser } from '../auth/auth-request';
import { ApiException, notFound } from '../common/api-exception';
import { pageMeta, type PageMeta } from '../common/query-reader';
import { AnnouncementAccessService } from './announcement-access.service';
import type { CreateCommentDto, ListCommentsQueryDto } from './dto/comment.dto';

export interface CommentDto {
  id: number;
  body: string;
  author: { id: number; name: string; role: UserRole };
  created_at: string;
  // Whether the caller may delete this comment. The server checks again.
  can_delete: boolean;
}

interface CommentRow {
  id: number | string;
  body: string;
  created_at: Date | string;
  author_id: number | string;
  author_name: string;
  author_role: UserRole;
}

interface PostRow {
  class_id: number | string;
  lecturer_id: number | string;
}

const COMMENT_SELECT = `SELECT c.id, c.body, c.created_at, u.id AS author_id, u.name AS author_name, u.role AS author_role
  FROM announcement_comments c JOIN users u ON u.id = c.author_id`;

// Likes and comments on announcements. Who may see a post comes from the shared
// class check; who may act (like, comment, delete) is decided here and by the
// role on each route.
@Injectable()
export class AnnouncementEngagementService {
  constructor(
    @Inject(DATABASE) private readonly database: DataSource,
    private readonly access: AnnouncementAccessService,
  ) {}

  // Inserts or removes one like and counts the likes in the same transaction,
  // so two quick requests give one like and the returned count is exact.
  // A repeated PUT or DELETE changes nothing and is not an error.
  async setLike(
    user: AuthenticatedUser,
    announcementId: number,
    liked: boolean,
  ): Promise<{ data: { liked: boolean; like_count: number } }> {
    await this.findVisiblePost(user, announcementId);
    const likeCount = await this.database.transaction(async (manager) => {
      if (liked)
        await manager.query(
          'INSERT IGNORE INTO announcement_likes (announcement_id, user_id) VALUES (?, ?)',
          [announcementId, user.id],
        );
      else
        await manager.query(
          'DELETE FROM announcement_likes WHERE announcement_id = ? AND user_id = ?',
          [announcementId, user.id],
        );
      const rows = (await manager.query(
        'SELECT COUNT(*) AS total FROM announcement_likes WHERE announcement_id = ?',
        [announcementId],
      )) as { total: number | string }[];
      return Number(rows[0]?.total ?? 0);
    });
    return { data: { liked, like_count: likeCount } };
  }

  async listComments(
    user: AuthenticatedUser,
    announcementId: number,
    query: ListCommentsQueryDto,
  ): Promise<{ data: CommentDto[]; meta: PageMeta }> {
    const post = await this.findVisiblePost(user, announcementId);
    const counted = (await this.database.query(
      'SELECT COUNT(*) AS total FROM announcement_comments WHERE announcement_id = ?',
      [announcementId],
    )) as { total: number | string }[];
    const total = Number(counted[0]?.total ?? 0);
    const rows = (await this.database.query(
      `${COMMENT_SELECT} WHERE c.announcement_id = ?
       ORDER BY c.created_at ASC, c.id ASC LIMIT ? OFFSET ?`,
      [announcementId, query.limit, (query.page - 1) * query.limit],
    )) as CommentRow[];
    return {
      data: rows.map((row) => this.toComment(row, user, post)),
      meta: pageMeta(query.page, query.limit, total),
    };
  }

  async createComment(
    user: AuthenticatedUser,
    announcementId: number,
    input: CreateCommentDto,
  ): Promise<{ data: CommentDto }> {
    const post = await this.findVisiblePost(user, announcementId);
    const result = (await this.database.query(
      'INSERT INTO announcement_comments (announcement_id, author_id, body) VALUES (?, ?, ?)',
      [announcementId, user.id, input.body],
    )) as { insertId: number | string };
    const rows = (await this.database.query(
      `${COMMENT_SELECT} WHERE c.id = ?`,
      [Number(result.insertId)],
    )) as CommentRow[];
    return { data: this.toComment(rows[0], user, post) };
  }

  // The author, the lecturer of the class and any admin may delete. A comment
  // in a class the caller cannot see looks the same as a missing comment.
  async deleteComment(
    user: AuthenticatedUser,
    commentId: number,
  ): Promise<void> {
    const rows = (await this.database.query(
      `SELECT c.author_id, a.class_id, cl.lecturer_id
       FROM announcement_comments c
       JOIN announcements a ON a.id = c.announcement_id
       JOIN classes cl ON cl.id = a.class_id
       WHERE c.id = ?`,
      [commentId],
    )) as (PostRow & { author_id: number | string })[];
    const comment = rows[0];
    if (
      !comment ||
      !(await this.access.canSeeClass(user, Number(comment.class_id)))
    )
      throw notFound('Comment not found.');
    if (!this.mayDelete(user, Number(comment.author_id), comment))
      throw new ApiException(
        403,
        'FORBIDDEN',
        'You cannot delete this comment.',
      );
    await this.database.query(
      'DELETE FROM announcement_comments WHERE id = ?',
      [commentId],
    );
  }

  // A post the caller may see, with the lecturer of its class. A hidden post
  // looks the same as a missing post.
  private async findVisiblePost(
    user: AuthenticatedUser,
    announcementId: number,
  ): Promise<PostRow> {
    const rows = (await this.database.query(
      `SELECT a.class_id, cl.lecturer_id
       FROM announcements a JOIN classes cl ON cl.id = a.class_id
       WHERE a.id = ?`,
      [announcementId],
    )) as PostRow[];
    const post = rows[0];
    if (!post || !(await this.access.canSeeClass(user, Number(post.class_id))))
      throw notFound('Announcement not found.');
    return post;
  }

  private mayDelete(
    user: AuthenticatedUser,
    authorId: number,
    post: PostRow,
  ): boolean {
    if (user.role === 'admin') return true;
    if (authorId === user.id) return true;
    return user.role === 'lecturer' && Number(post.lecturer_id) === user.id;
  }

  private toComment(
    row: CommentRow,
    user: AuthenticatedUser,
    post: PostRow,
  ): CommentDto {
    const authorId = Number(row.author_id);
    return {
      id: Number(row.id),
      body: row.body,
      author: { id: authorId, name: row.author_name, role: row.author_role },
      created_at: new Date(row.created_at).toISOString(),
      can_delete: this.mayDelete(user, authorId, post),
    };
  }
}
