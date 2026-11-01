import type { MigrationInterface, QueryRunner } from 'typeorm';

// Upgrade existing databases without rewriting the applied baseline migration.
export class SessionVenueSnapshot1793491200000 implements MigrationInterface {
  name = 'SessionVenueSnapshot1793491200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE class_sessions
      ADD room_label VARCHAR(100) NULL,
      ADD latitude DECIMAL(9,6) NULL,
      ADD longitude DECIMAL(9,6) NULL,
      ADD radius_m DECIMAL(10,2) NULL`);
    await runner.query(`UPDATE class_sessions s JOIN classes c ON c.id = s.class_id
      SET s.room_label = c.room_label, s.latitude = c.latitude,
          s.longitude = c.longitude, s.radius_m = c.radius_m`);
    await runner.query(`ALTER TABLE class_sessions
      MODIFY room_label VARCHAR(100) NOT NULL,
      MODIFY latitude DECIMAL(9,6) NOT NULL,
      MODIFY longitude DECIMAL(9,6) NOT NULL,
      MODIFY radius_m DECIMAL(10,2) NOT NULL,
      ADD CONSTRAINT ck_sessions_latitude CHECK (latitude BETWEEN -90 AND 90),
      ADD CONSTRAINT ck_sessions_longitude CHECK (longitude BETWEEN -180 AND 180),
      ADD CONSTRAINT ck_sessions_radius CHECK (radius_m > 0)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE class_sessions
      DROP CHECK ck_sessions_latitude, DROP CHECK ck_sessions_longitude, DROP CHECK ck_sessions_radius,
      DROP COLUMN room_label, DROP COLUMN latitude, DROP COLUMN longitude, DROP COLUMN radius_m`);
  }
}
