import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_ID } from '../class-management.rules';

// Field decorators shared by the create (required) and update (optional) DTOs.
// Optional fields may be omitted, but an explicit null is still rejected.

const optional = (required: boolean): PropertyDecorator[] =>
  required
    ? []
    : [ValidateIf((_object, value: unknown) => value !== undefined)];

const trim = (upper: boolean) =>
  Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return upper ? trimmed.toUpperCase() : trimmed;
  });

export function TextField(
  name: string,
  max: number,
  required = true,
): PropertyDecorator {
  const message = `${name} is required and must be at most ${max} characters.`;
  return applyDecorators(
    ...optional(required),
    trim(false),
    IsString({ message }),
    Length(1, max, { message }),
  );
}

// Upper-cased ASCII codes such as course codes and section labels.
export function CodeField(
  name: string,
  max: number,
  required = true,
): PropertyDecorator {
  const message = `${name} must be 1 to ${max} letters, digits or symbols with no spaces.`;
  return applyDecorators(
    ...optional(required),
    trim(true),
    IsString({ message }),
    Matches(new RegExp(`^[\\x21-\\x7E]{1,${max}}$`), { message }),
  );
}

export function IdField(name: string, required = true): PropertyDecorator {
  const message = `Select a valid ${name}.`;
  return applyDecorators(
    ...optional(required),
    IsInt({ message }),
    Min(1, { message }),
    Max(MAX_ID, { message }),
  );
}

export function DecimalField(
  name: string,
  min: number,
  max: number,
  places: number,
  required = true,
): PropertyDecorator {
  const message = `${name} must be a number between ${min} and ${max}.`;
  return applyDecorators(
    ...optional(required),
    IsNumber({ allowNaN: false, allowInfinity: false }, { message }),
    Min(min, { message }),
    Max(max, { message }),
    // Rounds to the column's precision before the range checks run.
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'number' && Number.isFinite(value)
        ? Number(value.toFixed(places))
        : value,
    ),
  );
}
