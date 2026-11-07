import {
  All,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { IsIn } from 'class-validator';
import type { UserRole } from '../database/entities';
import { ApiException } from '../common/api-exception';
import type { SessionRequest } from './dev-auth';
import { DEV_COOKIE_NAME, DevAuthService } from './dev-auth.service';
import { DevCsrfGuard } from './dev-auth.guard';
import { DevAuthExceptionFilter } from './dev-auth.filter';

export class SelectDevRoleDto {
  @IsIn(['student', 'lecturer', 'admin'], {
    message: 'Select student, lecturer or admin.',
  })
  role!: UserRole;
}

@Controller()
@UseFilters(DevAuthExceptionFilter)
export class DevAuthController {
  constructor(private readonly auth: DevAuthService) {}

  @Get('auth/csrf')
  @Header('Cache-Control', 'no-store')
  csrf(
    @Req() request: SessionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    let session = request.session;
    if (!session) {
      const created = this.auth.rotate(request.devSessionId);
      response.setHeader('Set-Cookie', created.cookie);
      session = created.session;
    }
    return { data: { csrfToken: session.csrfToken } };
  }

  @Get('auth/me')
  @Header('Cache-Control', 'no-store')
  async me(@Req() request: SessionRequest) {
    return { data: await this.auth.me(request.session) };
  }

  @Post('dev/auth/select-role')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @UseGuards(DevCsrfGuard)
  async selectRole(
    @Body() body: SelectDevRoleDto,
    @Req() request: SessionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const selected = await this.auth.selectRole(
      body.role,
      request.devSessionId,
    );
    response.setHeader('Set-Cookie', selected.cookie);
    return { data: selected.profile };
  }

  @Post('auth/logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @UseGuards(DevCsrfGuard)
  logout(
    @Req() request: SessionRequest,
    @Res({ passthrough: true }) response: Response,
  ): void {
    this.auth.destroy(request.devSessionId);
    response.setHeader(
      'Set-Cookie',
      `${DEV_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
    );
  }

  @All(['auth/csrf', 'auth/me', 'auth/logout', 'dev/auth/select-role'])
  unsupportedMethod(): never {
    throw new ApiException(
      404,
      'RESOURCE_NOT_FOUND',
      'The requested resource was not found.',
    );
  }
}
