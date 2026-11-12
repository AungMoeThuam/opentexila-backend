import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AttendanceGuard } from './attendance.guard';
import { FinalisationService } from './finalisation.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AttendanceCaller } from './attendance.rules';
import { ClassSessionParamsDto } from './dto/attendance-query.dto';
import { Roles } from '../auth/roles.decorator';

@Controller('class-sessions')
@UseGuards(AttendanceGuard)
@Roles('lecturer')
export class ClassSessionFinaliseController {
  constructor(public readonly finalisation: FinalisationService) {}

  @Post(':classSessionId/finalise')
  @HttpCode(200)
  finalise(
    @Param() params: ClassSessionParamsDto,
    @CurrentUser() user: AttendanceCaller,
  ) {
    return this.finalisation.finaliseClassSession(user, params.classSessionId);
  }
}
