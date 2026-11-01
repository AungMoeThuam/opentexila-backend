require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { callerFrom } = require('../dist/auth/dev-caller');
const { ApiException } = require('../dist/common/api-exception');

const requestWith = (headers) => ({ headers });

test('the caller id comes from the X-Dev-User-Id header', () => {
  assert.deepEqual(callerFrom(requestWith({ 'x-dev-user-id': '2' })), {
    id: 2,
  });
  assert.deepEqual(callerFrom(requestWith({ 'x-dev-user-id': '4294967295' })), {
    id: 4294967295,
  });
});

test('a missing, malformed or out-of-range header gives 422 with the header name', () => {
  for (const headers of [
    {},
    { 'x-dev-user-id': 'abc' },
    { 'x-dev-user-id': '0' },
    { 'x-dev-user-id': '1.5' },
    { 'x-dev-user-id': '4294967296' },
    { 'x-dev-user-id': '2, 3' },
  ]) {
    try {
      callerFrom(requestWith(headers));
      assert.fail('Expected callerFrom to throw.');
    } catch (error) {
      assert.ok(error instanceof ApiException);
      assert.equal(error.getStatus(), 422);
      const { code, fields } = error.getResponse().error;
      assert.equal(code, 'VALIDATION_ERROR');
      assert.deepEqual(Object.keys(fields), ['X-Dev-User-Id']);
    }
  }
});
