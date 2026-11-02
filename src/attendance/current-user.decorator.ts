import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AttendanceCaller } from './attendance.rules';
import type { AttendanceRequest } from './attendance.guard';
import { ApiException } from '../common/api-exception';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AttendanceCaller => {
    const request = ctx.switchToHttp().getRequest<AttendanceRequest>();
    if (!request.attendanceUser)
      throw new ApiException(
        401,
        'UNAUTHENTICATED',
        'Authentication required.',
      );
    return request.attendanceUser;
  },
);
