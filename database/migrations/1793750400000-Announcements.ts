import type { MigrationInterface, QueryRunner } from 'typeorm';

// Class announcements with likes and comments. Likes and comments are removed
// together with their announcement. Do not import current entities here.
const engine =
  'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

export class Announcements1793750400000 implements MigrationInterface {
  name = 'Announcements1793750400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const statements = [
      `CREATE TABLE announcements (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        class_id INT UNSIGNED NOT NULL,
        author_id INT UNSIGNED NOT NULL,
        category ENUM('general','class_change','reminder','exam') COLLATE utf8mb4_0900_as_cs NOT NULL DEFAULT 'general',
        title VARCHAR(150) NOT NULL,
        body VARCHAR(5000) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY ix_announcements_class_created (class_id, created_at, id),
        KEY ix_announcements_author (author_id),
        CONSTRAINT fk_announcements_class FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_announcements_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_announcements_title CHECK (CHAR_LENGTH(TRIM(title)) > 0),
        CONSTRAINT ck_announcements_body CHECK (CHAR_LENGTH(TRIM(body)) > 0)
      ) ${engine}`,
      `CREATE TABLE announcement_likes (
        announcement_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (announcement_id, user_id),
        KEY ix_announcement_likes_user (user_id),
        CONSTRAINT fk_announcement_likes_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE ON UPDATE RESTRICT,
        CONSTRAINT fk_announcement_likes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine}`,
      `CREATE TABLE announcement_comments (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        announcement_id INT UNSIGNED NOT NULL,
        author_id INT UNSIGNED NOT NULL,
        body VARCHAR(1000) NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY ix_announcement_comments_post (announcement_id, created_at, id),
        KEY ix_announcement_comments_author (author_id),
        CONSTRAINT fk_announcement_comments_announcement FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE ON UPDATE RESTRICT,
        CONSTRAINT fk_announcement_comments_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT ck_announcement_comments_body CHECK (CHAR_LENGTH(TRIM(body)) > 0)
      ) ${engine}`,
    ];
    for (const statement of statements) await queryRunner.query(statement);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE announcement_comments');
    await queryRunner.query('DROP TABLE announcement_likes');
    await queryRunner.query('DROP TABLE announcements');
  }
}
