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
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
  await app.listen(port, process.env.HOST ?? '127.0.0.1');
}

bootstrap().catch((error) => {
  console.error('Failed to start OpenTexila backend:', error);
  process.exitCode = 1;
});
