import type {
  EntitySchemaColumnOptions,
  EntitySchemaRelationOptions,
} from 'typeorm';

export const idColumn = (): EntitySchemaColumnOptions => ({
  type: 'int',
  unsigned: true,
  primary: true,
  generated: true,
});

export const referenceColumn = (
  nullable = false,
): EntitySchemaColumnOptions => ({
  type: 'int',
  unsigned: true,
  nullable,
});

// Composite primary key member that is also a foreign key.
export const keyReferenceColumn = (): EntitySchemaColumnOptions => ({
  type: 'int',
  unsigned: true,
  primary: true,
});

export const dateColumn = (nullable = false): EntitySchemaColumnOptions => ({
  type: 'datetime',
  precision: 3,
  nullable,
});

export const createdAtColumn = (): EntitySchemaColumnOptions => ({
  ...dateColumn(),
  createDate: true,
  default: () => 'CURRENT_TIMESTAMP(3)',
});

export const relation = (
  target: string,
  column: string,
  nullable = false,
): EntitySchemaRelationOptions => ({
  type: 'many-to-one',
  target,
  joinColumn: { name: column },
  nullable,
  onDelete: 'RESTRICT',
  onUpdate: 'RESTRICT',
  cascade: false,
});

export const locationColumns = (): Record<
  string,
  EntitySchemaColumnOptions
> => ({
  latitude: { type: 'decimal', precision: 9, scale: 6 },
  longitude: { type: 'decimal', precision: 9, scale: 6 },
  radius_m: { type: 'decimal', precision: 10, scale: 2 },
});
