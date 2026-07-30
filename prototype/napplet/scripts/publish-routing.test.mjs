import assert from 'node:assert/strict';
import test from 'node:test';
import { publishOutboxFirst } from '../src/publish-routing.ts';

const TEMPLATE = {
  kind: 78,
  content: '{"v":1,"name":"Routing Test"}',
  tags: [['d', 'nostr.pet.birth.v1']],
  created_at: 1_800_000_000,
};

test('lets the shell route a successful publish before considering fallbacks', async () => {
  const calls = [];
  const accepted = { ok: true, event: { id: 'accepted' } };
  const result = await publishOutboxFirst(
    async (template, options) => {
      calls.push({ template, options });
      return accepted;
    },
    TEMPLATE,
    {},
    ['wss://fallback.example'],
  );

  assert.equal(result, accepted);
  assert.deepEqual(calls, [{ template: TEMPLATE, options: {} }]);
});

test('does not bypass the shell for unrelated publish failures', async () => {
  const calls = [];
  const rejected = { ok: false, error: 'sign request rejected' };
  const result = await publishOutboxFirst(
    async (template, options) => {
      calls.push({ template, options });
      return rejected;
    },
    TEMPLATE,
    {},
    ['wss://fallback.example'],
  );

  assert.equal(result, rejected);
  assert.equal(calls.length, 1);
});

test('retries once with explicit relays only when the relay list is unavailable', async () => {
  const calls = [];
  const unavailable = { ok: false, error: 'Relay list unavailable for this account' };
  const accepted = { ok: true, event: { id: 'fallback-accepted' } };
  const result = await publishOutboxFirst(
    async (template, options) => {
      calls.push({ template, options });
      return calls.length === 1 ? unavailable : accepted;
    },
    TEMPLATE,
    { toOutbox: true, toInboxes: ['f'.repeat(64)] },
    ['wss://fallback.example'],
  );

  assert.equal(result, accepted);
  assert.deepEqual(calls, [
    {
      template: TEMPLATE,
      options: { toOutbox: true, toInboxes: ['f'.repeat(64)] },
    },
    {
      template: TEMPLATE,
      options: {
        relays: ['wss://fallback.example'],
        toOutbox: false,
        toInboxes: ['f'.repeat(64)],
      },
    },
  ]);
});
