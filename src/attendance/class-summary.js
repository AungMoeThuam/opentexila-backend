export const toIso = (date) => (date ? date.toISOString() : null);

// Needs the `course` and `teacher` relations loaded on the class.
export function toClassSummary(classroom) {
  return {
    id: classroom.id,
    course: {
      id: classroom.course.id,
      code: classroom.course.code,
      name: classroom.course.name,
    },
    section: classroom.section,
    term: classroom.term,
    lecturer: { id: classroom.teacher.id, name: classroom.teacher.name },
    room_label: classroom.room_label,
  };
}
