import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { IsNull } from 'typeorm';
import { DATABASE } from '../database/database.constants';
import { DEMO_CLASSES } from './demo-classes.data';

function sanitizeTeacher(teacher) {
  if (!teacher) return null;
  return {
    id: teacher.id,
    name: teacher.name,
    email: teacher.email,
    role: teacher.role,
  };
}

function toResponse(classroom) {
  return {
    id: classroom.id,
    code: classroom.code,
    name: classroom.name,
    subject: classroom.subject,
    term: classroom.term,
    room_label: classroom.room_label,
    teacher_id: classroom.teacher_id,
    teacher: sanitizeTeacher(classroom.teacher),
    latitude: classroom.latitude,
    longitude: classroom.longitude,
    radius_m: classroom.radius_m,
    max_accuracy_m: classroom.max_accuracy_m,
    schedule: classroom.schedule ?? null,
    enrolled_count: classroom.enrolled_count ?? 0,
    created_at: classroom.created_at,
    updated_at: classroom.updated_at,
  };
}

@Injectable()
export class ClassroomsService {
  constructor(database) {
    this.database = database;
    // The legacy `classrooms` table no longer exists (see ClassSchema), so this
    // module serves the static demo data only until it is rebuilt on `classes`.
    this.classrooms = null;
  }

  async list({
    page = 1,
    limit = 20,
    search,
    term,
    teacher_id,
    forceDemo = false,
  } = {}) {
    // 1. Try querying real database if connected and not forced to demo
    if (!forceDemo && this.classrooms && this.database?.isInitialized) {
      try {
        const whereClause = { archived_at: IsNull() };
        if (term) whereClause.term = term;
        if (teacher_id) whereClause.teacher_id = Number(teacher_id);

        const [classrooms, total] = await this.classrooms.findAndCount({
          where: whereClause,
          relations: { teacher: true },
          order: { id: 'ASC' },
          skip: (page - 1) * limit,
          take: limit,
        });

        // If the database has records, return them.
        if (total > 0) {
          return {
            data: classrooms.map(toResponse),
            meta: {
              page,
              limit,
              total,
              totalPages: Math.ceil(total / limit) || 0,
            },
          };
        }
      } catch {
        // Fall back to demo data on database read error
      }
    }

    // 2. Fall back to demo classes fixtures
    let filtered = DEMO_CLASSES.filter((c) => c.archived_at === null);

    if (search && typeof search === 'string') {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          c.subject.toLowerCase().includes(q) ||
          c.room_label.toLowerCase().includes(q),
      );
    }

    if (term && typeof term === 'string') {
      filtered = filtered.filter((c) => c.term === term);
    }

    if (teacher_id !== undefined) {
      filtered = filtered.filter((c) => c.teacher_id === Number(teacher_id));
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / limit) || 0;
    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    return {
      data: paginated.map(toResponse),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async findOne(id, { forceDemo = false } = {}) {
    // 1. Try querying real database if connected and not forced to demo
    if (!forceDemo && this.classrooms && this.database?.isInitialized) {
      try {
        const classroom = await this.classrooms.findOne({
          where: { id, archived_at: IsNull() },
          relations: { teacher: true },
        });
        if (classroom) {
          return { data: toResponse(classroom) };
        }
      } catch {
        // Fall back to demo fixtures
      }
    }

    // 2. Check demo classes fixtures
    const demoClass = DEMO_CLASSES.find(
      (c) => c.id === id && c.archived_at === null,
    );
    if (demoClass) {
      return { data: toResponse(demoClass) };
    }

    throw new NotFoundException('Class not found.');
  }

  async findMeetings(id, { page = 1, limit = 20, forceDemo = false } = {}) {
    // Check if class exists first
    await this.findOne(id, { forceDemo });

    const demoClass = DEMO_CLASSES.find((c) => c.id === id);
    const meetings = demoClass?.meetings ?? [];
    const total = meetings.length;
    const totalPages = Math.ceil(total / limit) || 0;
    const start = (page - 1) * limit;
    const paginated = meetings.slice(start, start + limit);

    return {
      data: paginated,
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }
}

// Explicit parameter injection for Babel/JavaScript.
Inject(DATABASE)(ClassroomsService, undefined, 0);
Optional()(ClassroomsService, undefined, 0);
