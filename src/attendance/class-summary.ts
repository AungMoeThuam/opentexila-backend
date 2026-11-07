import type { ClassEntity } from '../database/entities';

export function toIso(date: Date): string;
export function toIso(date: Date | null | undefined): string | null;
export function toIso(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

export interface ClassSummaryDto {
  id: number;
  course: {
    id: number;
    code: string;
    name: string;
  };
  section: string;
  term: string;
  lecturer: {
    id: number;
    name: string;
  };
  room_label: string;
}

// Needs the `course` and `lecturer` relations loaded on the class.
export function toClassSummary(classroom: ClassEntity): ClassSummaryDto {
  const { course, lecturer } = classroom;
  if (!course || !lecturer)
    throw new Error('Class summary requires course and lecturer relations.');
  return {
    id: classroom.id,
    course: {
      id: course.id,
      code: course.code,
      name: course.name,
    },
    section: classroom.section,
    term: classroom.term,
    lecturer: { id: lecturer.id, name: lecturer.name },
    room_label: classroom.room_label,
  };
}
