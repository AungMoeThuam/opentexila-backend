import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { notFound, validationError } from '../common/api-exception';
import {
  CLASS_IDENTITY_FIELDS,
  classHasSessions,
  classSectionTaken,
  definedEntries,
  duplicateKey,
  emptyUpdate,
  lecturerNotEligible,
  toDecimal,
} from './class-management.rules';
import type { CreateClassDto, UpdateClassDto } from './dto/class.dto';

// Satisfied by both DataSource and the transaction's EntityManager.
interface Queryable {
  query<T = any>(sql: string, parameters?: unknown[]): Promise<T>;
}

export interface ClassDetailDto {
  id: number;
  course: { id: number; code: string; name: string };
  term: string;
  section: string;
  lecturer: { id: number; name: string };
  room_label: string;
  latitude: string;
  longitude: string;
  radius_m: string;
  has_class_sessions: boolean;
}

interface ClassDetailRow {
  id: number;
  term: string;
  section: string;
  room_label: string;
  latitude: string;
  longitude: string;
  radius_m: string;
  course_id: number;
  course_code: string;
  course_name: string;
  lecturer_id: number;
  lecturer_name: string;
  has_class_sessions: number | string;
}

interface ClassRow {
  id: number;
  course_id: number;
  term: string;
  section: string;
  lecturer_id: number;
}

const COLUMNS = [
  'course_id',
  'term',
  'section',
  'lecturer_id',
  'room_label',
  'latitude',
  'longitude',
  'radius_m',
] as const;

const DETAIL_SQL = `SELECT c.id, c.term, c.section, c.room_label, c.latitude, c.longitude, c.radius_m,
    co.id AS course_id, co.code AS course_code, co.name AS course_name,
    u.id AS lecturer_id, u.name AS lecturer_name,
    EXISTS (SELECT 1 FROM class_sessions s WHERE s.class_id = c.id) AS has_class_sessions
  FROM classes c
  JOIN courses co ON co.id = c.course_id
  JOIN users u ON u.id = c.lecturer_id
  WHERE c.id = ?`;

@Injectable()
export class ClassManagementService {
  constructor(@Inject(DATABASE) private readonly database: DataSource) {}

  async getClass(classId: number) {
    return { data: await this.loadDetail(this.database, classId) };
  }

  async createClass(body: CreateClassDto) {
    return this.database.transaction(async (manager) => {
      await this.requireCourse(manager, body.course_id);
      await this.requireLecturer(manager, body.lecturer_id);
      let id: number;
      try {
        const result = await manager.query<{ insertId: number }>(
          `INSERT INTO classes (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`,
          COLUMNS.map((column) => body[column]),
        );
        id = Number(result.insertId);
      } catch (error) {
        if (duplicateKey(error) !== undefined) throw classSectionTaken();
        throw error;
      }
      return { data: await this.loadDetail(manager, id) };
    });
  }

  async updateClass(classId: number, body: UpdateClassDto) {
    const sent = definedEntries(body);
    if (Object.keys(sent).length === 0) throw emptyUpdate();

    return this.database.transaction(async (manager) => {
      // Check-ins lock this row first too, so they never interleave with an edit.
      const [current] = await manager.query<ClassRow[]>(
        'SELECT id, course_id, term, section, lecturer_id FROM classes WHERE id = ? FOR UPDATE',
        [classId],
      );
      if (!current) throw notFound('Class not found.');

      const changes = definedEntries(sent);
      for (const field of [
        'course_id',
        'term',
        'section',
        'lecturer_id',
      ] as const) {
        if (changes[field] !== undefined && changes[field] === current[field])
          delete changes[field];
      }

      const identityChanges = CLASS_IDENTITY_FIELDS.filter(
        (field) => changes[field] !== undefined,
      );
      if (identityChanges.length > 0) {
        // Inserting a session takes a shared lock on this class row (foreign key),
        // so no session can appear between this check and the update.
        const [row] = await manager.query<{ found: number | string }[]>(
          'SELECT EXISTS (SELECT 1 FROM class_sessions WHERE class_id = ?) AS found',
          [classId],
        );
        if (Number(row?.found) === 1) throw classHasSessions(identityChanges);
      }
      if (changes.course_id !== undefined)
        await this.requireCourse(manager, changes.course_id);
      if (changes.lecturer_id !== undefined)
        await this.requireLecturer(manager, changes.lecturer_id);

      const columns = COLUMNS.filter((column) => changes[column] !== undefined);
      if (columns.length > 0) {
        try {
          await manager.query(
            `UPDATE classes SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`,
            [...columns.map((column) => changes[column]), classId],
          );
        } catch (error) {
          if (duplicateKey(error) !== undefined) throw classSectionTaken();
          throw error;
        }
      }
      return { data: await this.loadDetail(manager, classId) };
    });
  }

  private async requireCourse(manager: Queryable, courseId: number) {
    const [course] = await manager.query<{ id: number }[]>(
      'SELECT id FROM courses WHERE id = ? FOR SHARE',
      [courseId],
    );
    if (!course)
      throw validationError({ course_id: 'Selected course does not exist.' });
  }

  // The shared lock stops the account changing role or status mid-assignment.
  private async requireLecturer(manager: Queryable, lecturerId: number) {
    const [user] = await manager.query<{ role: string; status: string }[]>(
      'SELECT role, status FROM users WHERE id = ? FOR SHARE',
      [lecturerId],
    );
    if (!user || user.role !== 'lecturer' || user.status !== 'active')
      throw lecturerNotEligible();
  }

  private async loadDetail(
    manager: Queryable,
    classId: number,
  ): Promise<ClassDetailDto> {
    const [row] = await manager.query<ClassDetailRow[]>(DETAIL_SQL, [classId]);
    if (!row) throw notFound('Class not found.');
    return {
      id: Number(row.id),
      course: {
        id: Number(row.course_id),
        code: row.course_code,
        name: row.course_name,
      },
      term: row.term,
      section: row.section,
      lecturer: { id: Number(row.lecturer_id), name: row.lecturer_name },
      room_label: row.room_label,
      latitude: toDecimal(row.latitude, 6),
      longitude: toDecimal(row.longitude, 6),
      radius_m: toDecimal(row.radius_m, 2),
      has_class_sessions: Number(row.has_class_sessions) === 1,
    };
  }
}
