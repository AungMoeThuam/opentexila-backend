import { QueryReader } from '../common/query-reader';

const HEADER = 'X-Dev-User-Id';

// TEMPORARY: auth is not built yet, so there is no guard and no check.
// The caller sends `X-Dev-User-Id: <users.id>` and the services scope data to it.
// When real auth lands, replace this function with the authenticated user.
export function callerFrom(request) {
  const reader = new QueryReader({
    [HEADER]: request.headers['x-dev-user-id'],
  });
  const id = reader.integer(HEADER, { max: 4294967295, required: true });
  reader.finish();
  return { id };
}
