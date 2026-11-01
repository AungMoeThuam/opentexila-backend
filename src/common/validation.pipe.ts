import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { validationError } from './api-exception';

export function formatValidationErrors(
  errors: ValidationError[],
  parent = '',
): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const error of errors) {
    const key = parent ? `${parent}.${error.property}` : error.property;

    if (error.constraints) {
      const messages = Object.values(error.constraints);
      if (messages.length > 0) {
        fields[key] = messages[0];
      }
    }

    if (error.children && error.children.length > 0) {
      Object.assign(fields, formatValidationErrors(error.children, key));
    }
  }

  return fields;
}

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors: ValidationError[]) => {
      return validationError(formatValidationErrors(errors));
    },
  });
}
