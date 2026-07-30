import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_LOCAL_RELAY_URL,
  eventRoutingFromConfig,
  getEventWithRouting,
  hybridReadRelayHints,
  publishEventWithRouting,
  queryEventsWithRouting,
} from '../src/event-routing.ts';

const LOCAL = {
  localRelayOnly: true,
  localRelayMirror: false,
  localRelayUrl: DEFAULT_LOCAL_RELAY_URL,
};
const HYBRID = {
  localRelayOnly: false,
  localRelayMirror: true,
  localRelayUrl: DEFAULT_LOCAL_RELAY_URL,
};
const FILTERS = [{ authors: ['a'.repeat(64)], kinds: [78] }];
const TEMPLATE = {
  kind: 78,
  content: '{"v":1,"name":"Local Test"}',
  tags: [['d', 'nostr.pet.birth.v1']],
  created_at: 1_800_000_000,
};

test('defaults to a loopback mirror and keeps local-only as an explicit override', () => {
  assert.deepEqual(eventRoutingFromConfig({}), HYBRID);
  assert.deepEqual(
    eventRoutingFromConfig({ nostrPetLocalRelayOnly: true }),
    LOCAL,
  );
  assert.deepEqual(
    eventRoutingFromConfig({ nostrPetLocalRelayMirror: false }),
    { localRelayOnly: false, localRelayMirror: false, localRelayUrl: '' },
  );
  assert.deepEqual(
    eventRoutingFromConfig({
      nostrPetLocalRelayOnly: true,
      nostrPetLocalRelayUrl: 'wss://relay.example',
    }),
    { localRelayOnly: false, localRelayMirror: false, localRelayUrl: '' },
  );
});

test('uses only the local hint alongside NIP-65 discovery when a relay list exists', () => {
  assert.deepEqual(
    hybridReadRelayHints(
      HYBRID,
      {
        source: 'nip65',
        relays: ['wss://nip65.example'],
      },
      ['wss://public.example'],
    ),
    [DEFAULT_LOCAL_RELAY_URL],
  );
});

test('uses local plus public fallback hints when NIP-65 is missing', () => {
  assert.deepEqual(
    hybridReadRelayHints(
      HYBRID,
      {
        source: 'fallback',
        relays: ['wss://shell-fallback.example'],
        missingAuthors: ['a'.repeat(64)],
      },
      ['wss://public.example', 'wss://shell-fallback.example'],
    ),
    [
      DEFAULT_LOCAL_RELAY_URL,
      'wss://shell-fallback.example',
      'wss://public.example',
    ],
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

test('queries NIP-65 routing through outbox with the local mirror as an explicit hint', async () => {
  const remoteEvents = [{ event: { id: 'hybrid-birth' } }];
  let relayCalls = 0;
  const result = await queryEventsWithRouting(
    HYBRID,
    async () => {
      relayCalls += 1;
      return [];
    },
    async (filters, options) => {
      assert.deepEqual(filters, FILTERS);
      assert.deepEqual(options, {
        authors: ['a'.repeat(64)],
        relays: ['wss://hint.example', DEFAULT_LOCAL_RELAY_URL],
      });
      return { events: remoteEvents };
    },
    FILTERS,
    {
      authors: ['a'.repeat(64)],
      relays: ['wss://hint.example'],
    },
  );
  assert.equal(relayCalls, 0);
  assert.equal(result.events, remoteEvents);
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

test('resolves events through outbox with the local mirror hint in hybrid mode', async () => {
  let relayCalls = 0;
  const parent = { event: { id: 'parent' } };
  const result = await getEventWithRouting(
    HYBRID,
    async () => {
      relayCalls += 1;
      return [];
    },
    async (eventId, options) => {
      assert.equal(eventId, 'parent');
      assert.deepEqual(options, {
        author: 'b'.repeat(64),
        relays: ['wss://parent.example', DEFAULT_LOCAL_RELAY_URL],
      });
      return { result: parent };
    },
    'parent',
    {
      author: 'b'.repeat(64),
      relays: ['wss://parent.example'],
    },
  );
  assert.equal(relayCalls, 0);
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

test('publishes to NIP-65 outbox relays and the local mirror in one primary request', async () => {
  const calls = [];
  const accepted = {
    ok: true,
    event: { id: 'hybrid-event' },
    relays: {
      [DEFAULT_LOCAL_RELAY_URL]: true,
      'wss://nip65.example': true,
    },
  };
  const result = await publishEventWithRouting(
    HYBRID,
    async (template, options) => {
      calls.push({ template, options });
      return accepted;
    },
    TEMPLATE,
    { toOutbox: true },
    ['wss://public.example'],
  );
  assert.equal(result, accepted);
  assert.deepEqual(calls, [
    {
      template: TEMPLATE,
      options: {
        relays: [DEFAULT_LOCAL_RELAY_URL],
        toOutbox: true,
      },
    },
  ]);
});

test('falls back to local plus public relays when NIP-65 is unavailable', async () => {
  const calls = [];
  const accepted = { ok: true, event: { id: 'fallback-event' } };
  const result = await publishEventWithRouting(
    HYBRID,
    async (template, options) => {
      calls.push({ template, options });
      return accepted;
    },
    TEMPLATE,
    { toOutbox: true, toInboxes: ['c'.repeat(64)] },
    ['wss://public.example', DEFAULT_LOCAL_RELAY_URL],
    false,
  );
  assert.equal(result, accepted);
  assert.deepEqual(calls, [
    {
      template: TEMPLATE,
      options: {
        relays: [DEFAULT_LOCAL_RELAY_URL, 'wss://public.example'],
        toOutbox: false,
      },
    },
  ]);
});

test('keeps one guarded retry when the relay plan was not resolved before publish', async () => {
  const calls = [];
  const unavailable = { ok: false, error: 'relay list unavailable' };
  const accepted = { ok: true, event: { id: 'late-fallback-event' } };
  const result = await publishEventWithRouting(
    HYBRID,
    async (template, options) => {
      calls.push({ template, options });
      return calls.length === 1 ? unavailable : accepted;
    },
    TEMPLATE,
    { toOutbox: true },
    ['wss://public.example'],
  );
  assert.equal(result, accepted);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].options, {
    relays: [DEFAULT_LOCAL_RELAY_URL, 'wss://public.example'],
    toOutbox: false,
  });
});
