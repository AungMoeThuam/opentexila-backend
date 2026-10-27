export const idColumn = () => ({
  type: 'int',
  unsigned: true,
  primary: true,
  generated: true,
});
export const referenceColumn = (nullable = false) => ({
  type: 'int',
  unsigned: true,
  nullable,
});
export const dateColumn = (nullable = false) => ({
  type: 'datetime',
  precision: 3,
  nullable,
});
export const auditColumns = () => ({
  created_at: {
    ...dateColumn(),
    createDate: true,
    default: () => 'CURRENT_TIMESTAMP(3)',
  },
  updated_at: {
    ...dateColumn(),
    updateDate: true,
    default: () => 'CURRENT_TIMESTAMP(3)',
    onUpdate: 'CURRENT_TIMESTAMP(3)',
  },
});
export const relation = (target, column, nullable = false) => ({
  type: 'many-to-one',
  target,
  joinColumn: { name: column },
  nullable,
  onDelete: 'RESTRICT',
  onUpdate: 'RESTRICT',
  cascade: false,
});
export const locationColumns = () => ({
  latitude: { type: 'decimal', precision: 9, scale: 6 },
  longitude: { type: 'decimal', precision: 9, scale: 6 },
  radius_m: { type: 'decimal', precision: 10, scale: 2 },
  max_accuracy_m: { type: 'decimal', precision: 10, scale: 2 },
});
