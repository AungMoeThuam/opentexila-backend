import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AttendanceCaller } from './attendance.rules';
import type { AttendanceRequest } from './attendance.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AttendanceCaller | undefined => {
    const request = ctx.switchToHttp().getRequest<AttendanceRequest>();
    return request?.attendanceUser;
  },
);
