import { HttpException } from '@nestjs/common';

// Carries the shared error envelope: { error: { code, message, fields } }.
export class ApiException extends HttpException {
  constructor(status, code, message, fields = {}) {
    super({ error: { code, message, fields } }, status);
  }
}

export const validationError = (fields) =>
  new ApiException(
    422,
    'VALIDATION_ERROR',
    'Please correct the highlighted fields.',
    fields,
  );

export const notFound = (message) =>
  new ApiException(404, 'RESOURCE_NOT_FOUND', message);
