import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCAL_RELAY_URL,
  eventRoutingFromConfig,
  getEventWithRouting,
  publishEventWithRouting,
  queryEventsWithRouting,
} from '../src/event-routing.ts';

const LOCAL = {
  localRelayOnly: true,
  localRelayUrl: DEFAULT_LOCAL_RELAY_URL,
};
const FILTERS = [{ authors: ['a'.repeat(64)], kinds: [78] }];
const TEMPLATE = {
  kind: 78,
  content: '{"v":1,"name":"Local Test"}',
  tags: [['d', 'nostr.pet.birth.v1']],
  created_at: 1_800_000_000,
};

test('enables local-only routing only for a loopback relay', () => {
  assert.deepEqual(
    eventRoutingFromConfig({ nostrPetLocalRelayOnly: true }),
    LOCAL,
  );
  assert.deepEqual(
    eventRoutingFromConfig({
      nostrPetLocalRelayOnly: true,
      nostrPetLocalRelayUrl: 'wss://relay.example',
    }),
    { localRelayOnly: false, localRelayUrl: '' },
  );
});

test('queries only the relay domain in local-only mode', async () => {
  const localEvents = [{ event: { id: 'local-birth' } }];
  let outboxCalls = 0;
  const result = await queryEventsWithRouting(
    LOCAL,
    async (filters) => {
      assert.deepEqual(filters, FILTERS);
      return localEvents;
    },
    async () => {
      outboxCalls += 1;
      return { events: [] };
    },
    FILTERS,
    { authors: ['a'.repeat(64)] },
  );
  assert.equal(outboxCalls, 0);
  assert.equal(result.events, localEvents);
});

test('resolves reply parents only from the local relay in local-only mode', async () => {
  const parent = { event: { id: 'parent', pubkey: 'b'.repeat(64), kind: 1 } };
  let outboxCalls = 0;
  const result = await getEventWithRouting(
    LOCAL,
    async () => [parent],
    async () => {
      outboxCalls += 1;
      return {};
    },
    'parent',
    { author: 'b'.repeat(64) },
  );
  assert.equal(outboxCalls, 0);
  assert.equal(result.result, parent);
});

test('publishes directly to the configured local relay without outbox or inbox discovery', async () => {
  const calls = [];
  const accepted = { ok: true, event: { id: 'local-event' } };
  const result = await publishEventWithRouting(
    LOCAL,
    async (template, options) => {
      calls.push({ template, options });
      return accepted;
    },
    TEMPLATE,
    { toOutbox: true, toInboxes: ['c'.repeat(64)] },
    ['wss://public.example'],
  );
  assert.equal(result, accepted);
  assert.deepEqual(calls, [
    {
      template: TEMPLATE,
      options: {
        relays: [DEFAULT_LOCAL_RELAY_URL],
        toOutbox: false,
      },
    },
  ]);
});
