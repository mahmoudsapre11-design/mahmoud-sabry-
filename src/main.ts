import 'dotenv/config';
import 'reflect-metadata';
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Needed so the Throttler sees the real client IP behind a proxy / load balancer
  app.set('trust proxy', 1);

  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // CVs and program materials are private: they are only served through
  // authorized controller endpoints, never as public static files.
  app.use(['/uploads/cvs', '/uploads/materials'], (_req, res) => {
    res.status(403).json({
      statusCode: 403,
      message: 'This file is private. Use the authorized download endpoint.',
    });
  });

  // Public static files (program cover images)
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Sanad Youth API running on http://localhost:${port}`);
}
bootstrap();
