import { ApiException } from '../common/api-exception';

// MySQL error 1062: another session of this class starts at the same time.
// A cancelled session still holds its start time, so it can cause this too.
export const isDuplicateKey = (error: unknown): boolean => {
  const driver = (error as { driverError?: { errno?: number }; errno?: number })
    ?.driverError;
  return (driver?.errno ?? (error as { errno?: number })?.errno) === 1062;
};

export const sessionExists = () =>
  new ApiException(
    409,
    'CLASS_SESSION_EXISTS',
    'This class already has a session that starts at this time.',
    { starts_at: 'This class already has a session that starts at this time.' },
  );
