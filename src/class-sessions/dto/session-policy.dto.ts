import { IsString, ValidateIf } from 'class-validator';
import {
  MAX_RADIUS_M,
  MIN_RADIUS_M,
} from '../../courses/class-management.rules';
import { DecimalField, TextField } from '../../courses/dto/fields';

// Body of PATCH /class-sessions/:classSessionId/attendance-policy. Every field
// is optional, but the service rejects a body that sets none of them. The venue
// rules are the same as for a class. The late time is checked in the service,
// against the start and end of this session.
export class UpdateSessionPolicyDto {
  @TextField('room_label', 100, false)
  room_label?: string;

  @DecimalField('latitude', -90, 90, 6, false)
  latitude?: number;

  @DecimalField('longitude', -180, 180, 6, false)
  longitude?: number;

  @DecimalField('radius_m', MIN_RADIUS_M, MAX_RADIUS_M, 2, false)
  radius_m?: number;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString({
    message: 'late_after must be a UTC time such as 2026-11-20T01:15:00.000Z.',
  })
  late_after?: string;
}
