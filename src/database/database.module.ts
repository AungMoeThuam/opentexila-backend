import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { databaseOptions } from './database-options';
import { DATABASE } from './database.constants';
import {
  UserSchema,
  CourseSchema,
  ClassSchema,
  EnrolmentSchema,
  ClassSessionSchema,
  AttendanceRecordSchema,
} from './entities';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => databaseOptions(process.env),
    }),
    TypeOrmModule.forFeature([
      UserSchema,
      CourseSchema,
      ClassSchema,
      EnrolmentSchema,
      ClassSessionSchema,
      AttendanceRecordSchema,
    ]),
  ],
  providers: [
    {
      provide: DATABASE,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) => dataSource,
    },
  ],
  exports: [TypeOrmModule, DATABASE],
})
export class DatabaseModule {}
