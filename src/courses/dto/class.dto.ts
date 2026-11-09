import { MAX_RADIUS_M, MIN_RADIUS_M } from '../class-management.rules';
import { CodeField, DecimalField, IdField, TextField } from './fields';

export class CreateClassDto {
  @IdField('course')
  course_id!: number;

  @TextField('term', 50)
  term!: string;

  @CodeField('section', 30)
  section!: string;

  @IdField('lecturer')
  lecturer_id!: number;

  @TextField('room_label', 100)
  room_label!: string;

  @DecimalField('latitude', -90, 90, 6)
  latitude!: number;

  @DecimalField('longitude', -180, 180, 6)
  longitude!: number;

  @DecimalField('radius_m', MIN_RADIUS_M, MAX_RADIUS_M, 2)
  radius_m!: number;
}

export class UpdateClassDto {
  @IdField('course', false)
  course_id?: number;

  @TextField('term', 50, false)
  term?: string;

  @CodeField('section', 30, false)
  section?: string;

  @IdField('lecturer', false)
  lecturer_id?: number;

  @TextField('room_label', 100, false)
  room_label?: string;

  @DecimalField('latitude', -90, 90, 6, false)
  latitude?: number;

  @DecimalField('longitude', -180, 180, 6, false)
  longitude?: number;

  @DecimalField('radius_m', MIN_RADIUS_M, MAX_RADIUS_M, 2, false)
  radius_m?: number;
}
