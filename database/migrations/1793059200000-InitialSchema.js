// Consolidated development baseline for a fresh MySQL 8.4 database.
// Existing development databases must be recreated separately. DDL implicitly commits.
// Do not import current EntitySchemas into historical migrations.
const engine =
  'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

class InitialSchema1793059200000 {
  name = 'InitialSchema1793059200000';

  async up(queryRunner) {
    const statements = [
      `CREATE TABLE users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(254) COLLATE utf8mb4_0900_as_ci NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('student','teacher','admin') COLLATE utf8mb4_0900_as_cs NOT NULL,
        status ENUM('active','inactive') COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'active',
        must_change_password TINYINT(1) NOT NULL DEFAULT 1,
        session_version INT UNSIGNED NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_users_email (email),
        KEY ix_users_role_status (role, status, id),
        CONSTRAINT ck_users_password CHECK (CHAR_LENGTH(password_hash) > 0),
        CONSTRAINT ck_users_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
        CONSTRAINT ck_users_email CHECK (CHAR_LENGTH(email) > 0 AND CAST(email AS BINARY) = CAST(LOWER(TRIM(email)) AS BINARY))
      ) ${engine}`,
      `CREATE TABLE courses (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        name VARCHAR(150) NOT NULL,
        UNIQUE KEY uq_courses_code (code),
        CONSTRAINT ck_courses_code CHECK (CHAR_LENGTH(code) > 0 AND CAST(code AS BINARY) = CAST(UPPER(TRIM(code)) AS BINARY)),
        CONSTRAINT ck_courses_name CHECK (CHAR_LENGTH(TRIM(name)) > 0)
      ) ${engine}`,
      `CREATE TABLE classes (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        course_id INT UNSIGNED NOT NULL,
        section VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        term VARCHAR(50) NOT NULL,
        teacher_id INT UNSIGNED NOT NULL,
        room_label VARCHAR(100) NOT NULL,
        latitude DECIMAL(9,6) NOT NULL, longitude DECIMAL(9,6) NOT NULL, radius_m DECIMAL(10,2) NOT NULL,
        UNIQUE KEY uq_classes_course_term_section (course_id, term, section), KEY ix_classes_teacher (teacher_id),
        CONSTRAINT fk_classes_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_classes_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_classes_section CHECK (CHAR_LENGTH(section) > 0 AND CAST(section AS BINARY) = CAST(UPPER(TRIM(section)) AS BINARY)),
        CONSTRAINT ck_classes_latitude CHECK (latitude BETWEEN -90 AND 90),
        CONSTRAINT ck_classes_longitude CHECK (longitude BETWEEN -180 AND 180),
        CONSTRAINT ck_classes_radius CHECK (radius_m > 0)
      ) ${engine}`,
      `CREATE TABLE enrolments (
        class_id INT UNSIGNED NOT NULL, student_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (class_id, student_id), KEY ix_enrolments_student (student_id),
        CONSTRAINT fk_enrolments_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_enrolments_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine}`,
      `CREATE TABLE class_sessions (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, class_id INT UNSIGNED NOT NULL,
        starts_at DATETIME(3) NOT NULL, late_after DATETIME(3) NOT NULL, ends_at DATETIME(3) NOT NULL,
        state ENUM('scheduled','cancelled') COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'scheduled',
        UNIQUE KEY uq_class_sessions_class_start (class_id, starts_at),
        KEY ix_class_sessions_due (state, starts_at, ends_at),
        CONSTRAINT fk_class_sessions_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_class_sessions_times CHECK (starts_at <= late_after AND late_after < ends_at)
      ) ${engine}`,
      `CREATE TABLE attendance_records (
        class_session_id INT UNSIGNED NOT NULL, student_id INT UNSIGNED NOT NULL,
        status ENUM('pending','present','late','absent') COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'pending',
        checked_in_at DATETIME(3) NULL, distance_m DECIMAL(10,2) NULL,
        PRIMARY KEY (class_session_id, student_id),
        KEY ix_records_student (student_id), KEY ix_records_roster (class_session_id, status),
        CONSTRAINT fk_records_session FOREIGN KEY (class_session_id) REFERENCES class_sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_records_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_records_evidence CHECK (
          (status IN ('pending','absent') AND checked_in_at IS NULL AND distance_m IS NULL) OR
          (status IN ('present','late') AND checked_in_at IS NOT NULL AND distance_m IS NOT NULL AND distance_m >= 0))
      ) ${engine}`,
      // express-mysql-session-compatible storage. Middleware integration is a separate auth task.
      `CREATE TABLE auth_sessions (
        session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
        expires INT UNSIGNED NOT NULL, data MEDIUMTEXT COLLATE utf8mb4_bin NULL,
        KEY ix_auth_sessions_expiry (expires)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`,
    ];
    for (const sql of statements) await queryRunner.query(sql);
  }

  async down(queryRunner) {
    for (const table of [
      'auth_sessions',
      'attendance_records',
      'class_sessions',
      'enrolments',
      'classes',
      'courses',
      'users',
    ]) {
      await queryRunner.query(`DROP TABLE \`${table}\``);
    }
  }
}

module.exports = { InitialSchema1793059200000 };
