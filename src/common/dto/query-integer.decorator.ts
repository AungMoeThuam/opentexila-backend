import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

// Reject arrays, whitespace, exponents and leading zeros before conversion.
export function QueryInteger(maximum: number): PropertyDecorator {
  const message = `Must be an integer between 1 and ${maximum}.`;
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : Number.NaN,
    ),
    IsInt({ message }),
    Min(1, { message }),
    Max(maximum, { message }),
  );
}
