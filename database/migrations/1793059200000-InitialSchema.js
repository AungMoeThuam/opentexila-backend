// Immutable migration. MySQL DDL implicitly commits; run it against MySQL 8.4.
// Do not import current EntitySchemas into historical migrations.
const audit = `created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`;
const location = `latitude DECIMAL(9,6) NOT NULL, longitude DECIMAL(9,6) NOT NULL,
  radius_m DECIMAL(10,2) NOT NULL, max_accuracy_m DECIMAL(10,2) NOT NULL`;
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
        institution_member_id VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        password_hash VARCHAR(255) NULL, role VARCHAR(20) COLLATE utf8mb4_0900_as_cs NOT NULL,
        status VARCHAR(20) COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'invited', activated_at DATETIME(3) NULL,
        session_version INT UNSIGNED NOT NULL DEFAULT 0, ${audit},
        UNIQUE KEY uq_users_email (email), UNIQUE KEY uq_users_member_id (institution_member_id),
        KEY ix_users_role_status (role, status, id),
        CONSTRAINT ck_users_role CHECK (role IN ('student','teacher','admin')),
        CONSTRAINT ck_users_status CHECK (status IN ('invited','active','inactive')),
        CONSTRAINT ck_users_activation CHECK (status <> 'active' OR (password_hash IS NOT NULL AND LENGTH(password_hash) > 0 AND activated_at IS NOT NULL)),
        CONSTRAINT ck_users_name CHECK (CHAR_LENGTH(TRIM(name)) > 0),
        CONSTRAINT ck_users_email CHECK (CHAR_LENGTH(email) > 0 AND CAST(email AS BINARY) = CAST(LOWER(TRIM(email)) AS BINARY)),
        CONSTRAINT ck_users_member_id CHECK (CHAR_LENGTH(institution_member_id) > 0 AND CAST(institution_member_id AS BINARY) = CAST(UPPER(TRIM(institution_member_id)) AS BINARY))
      ) ${engine}`,
      `CREATE TABLE account_invitations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id INT UNSIGNED NOT NULL,
        token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        expires_at DATETIME(3) NOT NULL, used_at DATETIME(3) NULL, revoked_at DATETIME(3) NULL,
        created_by INT UNSIGNED NOT NULL,
        outstanding_user_id INT UNSIGNED GENERATED ALWAYS AS (IF(used_at IS NULL AND revoked_at IS NULL, user_id, NULL)) VIRTUAL,
        ${audit}, UNIQUE KEY uq_invitations_token (token_hash),
        UNIQUE KEY uq_invitations_outstanding (outstanding_user_id),
        KEY ix_invitations_user (user_id, used_at, revoked_at), KEY ix_invitations_expiry (expires_at), KEY ix_invitations_creator (created_by),
        CONSTRAINT fk_invitations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_invitations_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_invitations_expiry CHECK (expires_at > created_at),
        CONSTRAINT ck_invitations_terminal CHECK (used_at IS NULL OR revoked_at IS NULL),
        CONSTRAINT ck_invitations_used CHECK (used_at IS NULL OR (used_at >= created_at AND used_at < expires_at)),
        CONSTRAINT ck_invitations_revoked CHECK (revoked_at IS NULL OR revoked_at >= created_at),
        CONSTRAINT ck_invitations_hash CHECK (REGEXP_LIKE(token_hash, '^[0-9a-f]{64}$', 'c'))
      ) ${engine}`,
      `CREATE TABLE classrooms (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
        name VARCHAR(150) NOT NULL, subject VARCHAR(150) NOT NULL, term VARCHAR(50) NOT NULL,
        teacher_id INT UNSIGNED NOT NULL, room_label VARCHAR(100) NOT NULL, ${location}, archived_at DATETIME(3) NULL, ${audit},
        UNIQUE KEY uq_classrooms_code_term (code, term), KEY ix_classrooms_teacher (teacher_id, archived_at),
        CONSTRAINT fk_classrooms_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_classrooms_code CHECK (CHAR_LENGTH(code) > 0 AND CAST(code AS BINARY) = CAST(UPPER(TRIM(code)) AS BINARY)),
        CONSTRAINT ck_classrooms_latitude CHECK (latitude BETWEEN -90 AND 90),
        CONSTRAINT ck_classrooms_longitude CHECK (longitude BETWEEN -180 AND 180),
        CONSTRAINT ck_classrooms_radius CHECK (radius_m > 0 AND max_accuracy_m > 0 AND max_accuracy_m <= radius_m)
      ) ${engine}`,
      `CREATE TABLE enrolments (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        classroom_id INT UNSIGNED NOT NULL, student_id INT UNSIGNED NOT NULL,
        enrolled_at DATETIME(3) NOT NULL, withdrawn_at DATETIME(3) NULL,
        active_student_id INT UNSIGNED GENERATED ALWAYS AS (IF(withdrawn_at IS NULL, student_id, NULL)) VIRTUAL,
        ${audit}, UNIQUE KEY uq_enrolments_current (classroom_id, active_student_id),
        KEY ix_enrolments_class_student (classroom_id, student_id, withdrawn_at),
        KEY ix_enrolments_student (student_id, withdrawn_at, classroom_id),
        CONSTRAINT fk_enrolments_class FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_enrolments_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_enrolments_interval CHECK (withdrawn_at IS NULL OR withdrawn_at > enrolled_at)
      ) ${engine}`,
      `CREATE TABLE class_meetings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, classroom_id INT UNSIGNED NOT NULL,
        starts_at DATETIME(3) NOT NULL, late_after DATETIME(3) NOT NULL, ends_at DATETIME(3) NOT NULL,
        state VARCHAR(20) COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'scheduled', created_by INT UNSIGNED NOT NULL,
        cancelled_at DATETIME(3) NULL, cancelled_by INT UNSIGNED NULL, cancellation_reason VARCHAR(500) NULL,
        ${audit}, UNIQUE KEY uq_meetings_class_start (classroom_id, starts_at),
        KEY ix_meetings_due (state, starts_at, ends_at), KEY ix_meetings_creator (created_by), KEY ix_meetings_canceller (cancelled_by),
        CONSTRAINT fk_meetings_class FOREIGN KEY (classroom_id) REFERENCES classrooms(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_meetings_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_meetings_canceller FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_meetings_times CHECK (starts_at <= late_after AND late_after < ends_at),
        CONSTRAINT ck_meetings_state CHECK (state IN ('scheduled','cancelled')),
        CONSTRAINT ck_meetings_cancellation CHECK (
          (state = 'scheduled' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL) OR
          (state = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND CHAR_LENGTH(TRIM(cancellation_reason)) > 0))
      ) ${engine}`,
      `CREATE TABLE attendance_sessions (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, meeting_id INT UNSIGNED NOT NULL,
        opens_at DATETIME(3) NOT NULL, late_after DATETIME(3) NOT NULL, closes_at DATETIME(3) NOT NULL,
        closed_at DATETIME(3) NULL, state VARCHAR(20) COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'open',
        room_label VARCHAR(100) NOT NULL, ${location},
        cancelled_at DATETIME(3) NULL, cancelled_by INT UNSIGNED NULL, cancellation_reason VARCHAR(500) NULL,
        ${audit}, UNIQUE KEY uq_sessions_meeting (meeting_id), KEY ix_sessions_closing (state, closes_at), KEY ix_sessions_canceller (cancelled_by),
        CONSTRAINT fk_sessions_meeting FOREIGN KEY (meeting_id) REFERENCES class_meetings(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_sessions_canceller FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_sessions_times CHECK (opens_at <= late_after AND late_after < closes_at),
        CONSTRAINT ck_sessions_latitude CHECK (latitude BETWEEN -90 AND 90),
        CONSTRAINT ck_sessions_longitude CHECK (longitude BETWEEN -180 AND 180),
        CONSTRAINT ck_sessions_radius CHECK (radius_m > 0 AND max_accuracy_m > 0 AND max_accuracy_m <= radius_m),
        CONSTRAINT ck_sessions_closed CHECK (closed_at IS NULL OR closed_at >= closes_at),
        CONSTRAINT ck_sessions_lifecycle CHECK (
          (state = 'open' AND closed_at IS NULL AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL) OR
          (state = 'closed' AND closed_at IS NOT NULL AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL) OR
          (state = 'cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND CHAR_LENGTH(TRIM(cancellation_reason)) > 0))
      ) ${engine}`,
      `CREATE TABLE attendance_records (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        session_id INT UNSIGNED NOT NULL, student_id INT UNSIGNED NOT NULL,
        status VARCHAR(20) COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'pending', checked_in_at DATETIME(3) NULL,
        distance_m DECIMAL(10,2) NULL, accuracy_m DECIMAL(10,2) NULL, location_validated_at DATETIME(3) NULL,
        ${audit}, UNIQUE KEY uq_records_session_student (session_id, student_id),
        KEY ix_records_student (student_id, session_id), KEY ix_records_roster (session_id, status, id),
        CONSTRAINT fk_records_session FOREIGN KEY (session_id) REFERENCES attendance_sessions(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_records_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_records_evidence CHECK (
          (status IN ('pending','absent') AND checked_in_at IS NULL AND distance_m IS NULL AND accuracy_m IS NULL AND location_validated_at IS NULL) OR
          (status IN ('present','late') AND checked_in_at IS NOT NULL AND distance_m IS NOT NULL AND distance_m >= 0 AND accuracy_m IS NOT NULL AND accuracy_m >= 0 AND location_validated_at IS NOT NULL))
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
      'attendance_sessions',
      'class_meetings',
      'enrolments',
      'classrooms',
      'account_invitations',
      'users',
    ]) {
      await queryRunner.query(`DROP TABLE \`${table}\``);
    }
  }
}

module.exports = { InitialSchema1793059200000 };
