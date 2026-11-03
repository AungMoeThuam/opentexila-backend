import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UseFilters,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthExceptionFilter } from './auth.filter';
import { AuthService } from './auth.service';
import { AuthCookies } from './auth.cookies';
import { AuthThrottleGuard } from './auth-throttle.guard';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';

@Controller('auth')
@UseFilters(AuthExceptionFilter)
@UseGuards(AuthThrottleGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookies,
  ) {}

  @Get('csrf')
  @Header('Cache-Control', 'no-store')
  async csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return { data: { csrfToken: await this.cookies.csrf(request, response) } };
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.cookies.checkCsrf(request);
    return this.cookies.issue(request, response, await this.auth.login(input));
  }

  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.cookies.checkCsrf(request);
    return this.cookies.issue(
      request,
      response,
      await this.auth.refresh(this.cookies.refresh(request)),
    );
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@Req() request: Request) {
    return { data: await this.auth.me(request.headers.authorization) };
  }

  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.cookies.checkCsrf(request);
    await this.auth.logout(this.cookies.refresh(request));
    this.cookies.clear(response);
  }

  @Post('change-password')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async changePassword(
    @Body() input: ChangePasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // Bearer credential is explicitly supplied, rather than authenticated by cookie.
    await this.auth.changePassword(request.headers.authorization, input);
    this.cookies.clear(response);
  }
}
