// Derived from the server clock; the database does not store it.
export function availabilityFor({ state, starts_at, ends_at }, now) {
  if (state === 'cancelled') return 'cancelled';
  if (now < starts_at) return 'upcoming';
  if (now < ends_at) return 'in_progress';
  return 'ended';
}
