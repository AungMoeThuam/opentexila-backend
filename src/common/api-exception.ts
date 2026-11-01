import { HttpException } from '@nestjs/common';

export type ErrorFields = Record<string, string>;

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields: ErrorFields;
  };
}

// Carries the shared error envelope: { error: { code, message, fields } }.
export class ApiException extends HttpException {
  constructor(
    status: number,
    code: string,
    message: string,
    fields: ErrorFields = {},
  ) {
    super({ error: { code, message, fields } }, status);
  }
}

export const validationError = (fields: ErrorFields): ApiException =>
  new ApiException(
    422,
    'VALIDATION_ERROR',
    'Please correct the highlighted fields.',
    fields,
  );

export const notFound = (message: string): ApiException =>
  new ApiException(404, 'RESOURCE_NOT_FOUND', message);
