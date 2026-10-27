import path from 'node:path';
import { entities } from './entities';

export function databaseOptions(env = process.env) {
  const port = Number(env.DB_PORT ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('DB_PORT must be between 1 and 65535.');
  for (const key of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
    if (!env[key]?.trim())
      throw new Error(`${key} is required. See .env.example.`);
  }
  return {
    type: 'mysql',
    connectorPackage: 'mysql2',
    host: env.DB_HOST,
    port,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    charset: 'utf8mb4_0900_ai_ci',
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: true,
    entities,
    migrations: [path.resolve(__dirname, '../../database/migrations/*.js')],
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'none',
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: { connectionLimit: 5, multipleStatements: false },
  };
}
