import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeEvent } from 'nostr-tools/pure';
import { makeZapReceipt } from 'nostr-tools/nip57';
import {
  classifyInboundDelivery,
  classifyOwnerActivityDelivery,
  LiveSignalAggregator,
  reactionForLiveAggregate,
} from '../src/live-aggregation.ts';

globalThis.window ??= globalThis;
const ZAP_REQUEST_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

function zapReceipt(ownerPubkey) {
  const request = finalizeEvent({
    kind: 9734,
    created_at: 100,
    content: '',
    tags: [
      ['p', ownerPubkey],
      ['amount', '1000000'],
      ['relays', 'wss://relay.example'],
    ],
  }, ZAP_REQUEST_KEY);
  return {
    id: 'f'.repeat(64),
    sig: 'b'.repeat(128),
    pubkey: 'c'.repeat(64),
    ...makeZapReceipt({
      zapRequest: JSON.stringify(request),
      bolt11: `lnbc10u1${'q'.repeat(52)}`,
      paidAt: new Date(101_000),
    }),
  };
}

function signal(overrides = {}) {
  return {
    id: 'owner-activity:event-1',
    channelId: 'owner-activity',
    eventId: 'event-1',
    actorPubkey: 'a'.repeat(64),
    receivedAt: 100,
    eventCreatedAt: 100,
    type: 'owner-published',
    ...overrides,
  };
}

test('a burst becomes one aggregate with counts by signal type', () => {
  const aggregates = [];
  const aggregator = new LiveSignalAggregator({
    windowMs: 60_000,
    logger: () => {},
    onAggregate: (aggregate) => aggregates.push(aggregate),
  });
  aggregator.push(signal());
  aggregator.push(signal({
    id: 'owner-activity:event-2',
    eventId: 'event-2',
    receivedAt: 101,
    type: 'owner-replied',
  }));
  aggregator.flush();

  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].total, 2);
  assert.equal(aggregates[0].actorCount, 1);
  assert.deepEqual(aggregates[0].byType, {
    'owner-published': 1,
    'owner-replied': 1,
  });
  aggregator.destroy();
});

test('owner publishing wins the reaction policy for a mixed burst', () => {
  const aggregate = {
    windowStartedAt: 100,
    windowEndedAt: 101,
    total: 2,
    actorCount: 1,
    byType: { 'owner-published': 1, 'owner-replied': 1 },
    representativeSignal: signal(),
  };
  assert.equal(reactionForLiveAggregate(aggregate), 'celebrate');
  assert.equal(
    reactionForLiveAggregate({
      ...aggregate,
      byType: { 'owner-replied': 2 },
    }),
    'notice',
  );
});

test('owner activity classification distinguishes top-level notes from replies', () => {
  const base = {
    id: 'f'.repeat(64),
    sig: 'b'.repeat(128),
    pubkey: 'a'.repeat(64),
    kind: 1,
    content: 'user-authored text',
    tags: [],
    created_at: 101,
  };
  assert.equal(
    classifyOwnerActivityDelivery({ event: base, receivedAt: 102 })?.type,
    'owner-published',
  );
  assert.equal(
    classifyOwnerActivityDelivery({
      event: { ...base, tags: [['e', 'c'.repeat(64)]] },
      receivedAt: 102,
    })?.type,
    'owner-replied',
  );
  assert.equal(
    classifyOwnerActivityDelivery({ event: { ...base, kind: 7 }, receivedAt: 102 }),
    null,
  );
});

test('only kind 9735 events directed to the owner classify as live zaps', () => {
  const ownerPubkey = 'd'.repeat(64);
  const base = zapReceipt(ownerPubkey);
  assert.equal(
    classifyInboundDelivery({ event: base, ownerPubkey, receivedAt: 102 })?.type,
    'zap-received',
  );
  assert.equal(
    classifyInboundDelivery({ event: base, ownerPubkey, receivedAt: 102 })?.zap?.amountSats,
    1000,
  );
  assert.equal(
    classifyInboundDelivery({
      event: { ...base, kind: 7 },
      ownerPubkey,
      receivedAt: 102,
    }),
    null,
  );
  assert.equal(
    classifyInboundDelivery({
      event: zapReceipt('e'.repeat(64)),
      ownerPubkey,
      receivedAt: 102,
    }),
    null,
  );
  assert.equal(
    classifyInboundDelivery({
      event: {
        ...base,
        tags: base.tags.map((tag) => tag[0] === 'description'
          ? ['description', '{"not":"signed"}']
          : tag),
      },
      ownerPubkey,
      receivedAt: 102,
    }),
    null,
  );
});

test('a zap wins aggregate reaction selection', () => {
  const aggregate = {
    windowStartedAt: 100,
    windowEndedAt: 101,
    total: 2,
    actorCount: 2,
    byType: { 'owner-published': 1, 'zap-received': 1 },
    representativeSignal: signal({ type: 'zap-received' }),
  };
  assert.equal(reactionForLiveAggregate(aggregate), 'zap-celebrate');
});

test('a mixed aggregate preserves its zap as the representative signal', () => {
  const aggregates = [];
  const aggregator = new LiveSignalAggregator({
    windowMs: 60_000,
    logger: () => {},
    onAggregate: (aggregate) => aggregates.push(aggregate),
  });
  aggregator.push(signal({
    id: 'zap',
    eventId: 'zap-event',
    type: 'zap-received',
    zap: { amountSats: 21, senderPubkey: 'sender', zapRequestId: 'request' },
  }));
  aggregator.push(signal({ id: 'note', eventId: 'note-event', receivedAt: 101 }));
  aggregator.flush();

  assert.equal(aggregates[0].representativeSignal.type, 'zap-received');
  assert.equal(aggregates[0].representativeSignal.zap.amountSats, 21);
  aggregator.destroy();
});
