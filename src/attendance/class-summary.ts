import type { ClassEntity } from '../database/entities';

export const toIso = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

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

// Needs the `course` and `teacher` relations loaded on the class.
export function toClassSummary(classroom: ClassEntity): ClassSummaryDto {
  return {
    id: classroom.id,
    course: {
      id: classroom.course!.id,
      code: classroom.course!.code,
      name: classroom.course!.name,
    },
    section: classroom.section,
    term: classroom.term,
    lecturer: { id: classroom.teacher!.id, name: classroom.teacher!.name },
    room_label: classroom.room_label,
  };
}
