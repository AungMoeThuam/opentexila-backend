// Run with application writers stopped. MySQL DDL implicitly commits.
// Only the known demo fixture has an agreed legacy mapping. Unknown rows must
// be mapped explicitly in a reviewed migration; never guess sections from codes.
class CourseSections1793145600000 {
  name = 'CourseSections1793145600000';

  async up(runner) {
    const rows = await runner.query(
      'SELECT id, code, subject, term FROM classrooms',
    );
    const unsupported = rows.filter(
      (row) =>
        row.code !== 'COS30043-DEMO' ||
        row.subject !== 'Interface Design and Development' ||
        row.term !== 'DEMO',
    );
    if (unsupported.length)
      throw new Error(
        `Course/section mapping required for classroom IDs: ${unsupported.map((row) => row.id).join(', ')}. No schema changes applied.`,
      );

    await runner.query(`CREATE TABLE courses (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      name VARCHAR(150) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      UNIQUE KEY uq_courses_code (code),
      CONSTRAINT ck_courses_code CHECK (CHAR_LENGTH(code) > 0 AND CAST(code AS BINARY) = CAST(UPPER(TRIM(code)) AS BINARY)),
      CONSTRAINT ck_courses_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await runner.query(`ALTER TABLE classrooms
      ADD COLUMN course_id INT UNSIGNED NULL,
      ADD COLUMN section VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL`);
    if (rows.length) {
      await runner.query(
        "INSERT INTO courses(code, name) VALUES ('COS30043', 'Interface Design and Development')",
      );
      // Explicitly assign updated_at to itself to preserve the classroom audit time.
      await runner.query(`UPDATE classrooms SET course_id=(SELECT id FROM courses WHERE code='COS30043'),
        section='DEMO', updated_at=updated_at`);
    }
    await runner.query(`ALTER TABLE classrooms
      MODIFY course_id INT UNSIGNED NOT NULL,
      MODIFY section VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      MODIFY code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NULL,
      MODIFY name VARCHAR(150) NULL,
      MODIFY subject VARCHAR(150) NULL,
      DROP INDEX uq_classrooms_code_term,
      ADD UNIQUE KEY uq_classrooms_course_term_section (course_id, term, section),
      ADD CONSTRAINT fk_classrooms_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
      ADD CONSTRAINT ck_classrooms_section CHECK (CHAR_LENGTH(section) > 0 AND CAST(section AS BINARY) = CAST(UPPER(TRIM(section)) AS BINARY))`);
  }

  async down(runner) {
    // Roll back only when the new model still consists entirely of the mapped
    // legacy fixture (or is empty). Do not discard new courses/sections silently.
    const rows =
      await runner.query(`SELECT c.id, c.code, c.name, c.subject, c.term, c.section,
      course.code AS course_code, course.name AS course_name
      FROM classrooms c JOIN courses course ON course.id=c.course_id`);
    const [unused] =
      await runner.query(`SELECT COUNT(*) AS count FROM courses course
      WHERE NOT EXISTS (SELECT 1 FROM classrooms c WHERE c.course_id=course.id)`);
    if (
      Number(unused.count) ||
      rows.some(
        (row) =>
          row.code !== 'COS30043-DEMO' ||
          row.name === null ||
          row.subject !== 'Interface Design and Development' ||
          row.term !== 'DEMO' ||
          row.section !== 'DEMO' ||
          row.course_code !== 'COS30043' ||
          row.course_name !== 'Interface Design and Development',
      )
    ) {
      throw new Error(
        'Rollback would discard new course/section data. Restore a backup or create a forward migration; no schema changes applied.',
      );
    }
    await runner.query(`ALTER TABLE classrooms
      DROP FOREIGN KEY fk_classrooms_course,
      DROP CHECK ck_classrooms_section,
      DROP INDEX uq_classrooms_course_term_section,
      DROP COLUMN course_id,
      DROP COLUMN section,
      MODIFY code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      MODIFY name VARCHAR(150) NOT NULL,
      MODIFY subject VARCHAR(150) NOT NULL,
      ADD UNIQUE KEY uq_classrooms_code_term (code, term)`);
    await runner.query('DROP TABLE courses');
  }
}

module.exports = { CourseSections1793145600000 };
