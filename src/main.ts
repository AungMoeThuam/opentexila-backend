import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createValidationPipe } from './common/validation.pipe';

async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const app = await NestFactory.create(AppModule);
  // Behind a reverse proxy, count its hops so request.ip is the real client
  // (the sign-in throttle uses it). Leave unset when nothing sits in front.
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops < 0 || hops > 5)
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
  if (hops > 0) app.getHttpAdapter().getInstance().set('trust proxy', hops);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
}

bootstrap().catch((error) => {
  console.error('Failed to start OpenTexila backend:', error);
  process.exitCode = 1;
});
