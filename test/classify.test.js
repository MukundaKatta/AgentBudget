import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyException, fingerprintException } from '../src/index.js';

class Retryable extends Error {}
class Fatal extends Error {}

test('classified retryable when in retryOn', () => {
  assert.equal(
    classifyException(new Retryable(), { retryOn: [Retryable] }),
    'retryable',
  );
});

test('fatalOn wins over retryOn', () => {
  class Both extends Retryable {}
  Object.setPrototypeOf(Both.prototype, Fatal.prototype);
  // Note: instanceof checks both chains via fatalOn first.
  assert.equal(
    classifyException(new Fatal(), { retryOn: [Fatal], fatalOn: [Fatal] }),
    'fatal',
  );
});

test('unknown when in neither set', () => {
  assert.equal(classifyException(new TypeError('x')), 'unknown');
});

test('fingerprint includes constructor name and message', () => {
  const fp = fingerprintException(new RangeError('boom'));
  assert.match(fp, /RangeError/);
  assert.match(fp, /boom/);
});

test('fingerprint truncates long messages', () => {
  const fp = fingerprintException(new Error('x'.repeat(5000)));
  assert.ok(fp.length < 300);
});

test('fingerprint of non-Error value still produces a string', () => {
  const fp = fingerprintException('a plain string');
  assert.equal(typeof fp, 'string');
  assert.ok(fp.length > 0);
});
