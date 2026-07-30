import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCopyOptions } from './copy-events-to-local-relay.mjs';

test('builds a narrow exact-event copy filter', () => {
  const eventId = 'a'.repeat(64);
  const options = parseCopyOptions(['--event', eventId]);
  assert.deepEqual(options.filter, {
    ids: [eventId],
    limit: 20,
  });
  assert.equal(options.destination, 'ws://127.0.0.1:7777');
  assert.equal(options.sources.length, 4);
});

test('supports an author, kind, d-tag, and explicit source', () => {
  const author = 'b'.repeat(64);
  const options = parseCopyOptions([
    '--author',
    author,
    '--kind',
    '78',
    '--d',
    'nostr.pet.birth.v1',
    '--source',
    'wss://relay.example',
  ]);
  assert.deepEqual(options.filter, {
    authors: [author],
    kinds: [78],
    '#d': ['nostr.pet.birth.v1'],
    limit: 20,
  });
  assert.deepEqual(options.sources, ['wss://relay.example']);
});

test('refuses broad relay copies', () => {
  assert.throws(
    () => parseCopyOptions([]),
    /Provide at least one --event id or one --author pubkey/,
  );
});
