import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AttendanceGuard } from '../attendance/attendance.guard';
import { Roles } from '../auth/roles.decorator';
import { AdminUsersService } from './admin-users.service';
import {
  CreateUserDto,
  ResetPasswordDto,
  UserParamsDto,
} from './dto/admin-user.dto';

// Admin-only account provisioning. There is no public registration.
@Controller('admin/users')
@UseGuards(AttendanceGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Post()
  create(@Body() body: CreateUserDto) {
    return this.users.createUser(body);
  }

  @Post(':userId/reset-password')
  @HttpCode(204)
  async resetPassword(
    @Param() params: UserParamsDto,
    @Body() body: ResetPasswordDto,
  ): Promise<void> {
    await this.users.resetPassword(params.userId, body);
  }
}
