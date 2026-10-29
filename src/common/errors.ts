import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

const logger = new Logger('Errors');

/** Maps any thrown value to a proper HttpException (Prisma errors -> 4xx, unknown -> 500). */
export function toHttpException(e: unknown, context: string): HttpException {
  if (e instanceof HttpException) return e;

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case 'P2002':
        return new ConflictException('A record with the same unique value already exists');
      case 'P2025':
        return new NotFoundException('Record not found');
      case 'P2003':
        return new BadRequestException('Related record not found or still in use');
      case 'P2034':
        return new ConflictException('Concurrent update detected, please retry');
    }
  }
  if (e instanceof Prisma.PrismaClientValidationError) {
    return new BadRequestException('Invalid data');
  }

  logger.error(`${context}: ${(e as Error)?.message}`, (e as Error)?.stack);
  return new InternalServerErrorException('Unexpected server error');
}

/**
 * Class decorator: wraps every method of a service in try/catch so that
 * database/unknown errors are always converted to a clean HTTP error.
 */
export function HandleErrors(): ClassDecorator {
  return (target: any) => {
    for (const name of Object.getOwnPropertyNames(target.prototype)) {
      if (name === 'constructor') continue;
      const descriptor = Object.getOwnPropertyDescriptor(target.prototype, name);
      if (!descriptor || typeof descriptor.value !== 'function') continue;

      const original = descriptor.value;
      Object.defineProperty(target.prototype, name, {
        ...descriptor,
        value: async function (...args: any[]) {
          try {
            return await original.apply(this, args);
          } catch (e) {
            throw toHttpException(e, `${target.name}.${name}`);
          }
        },
      });
    }
  };
}
