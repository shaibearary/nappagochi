import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveSessionManager } from '../src/live-session.ts';

function event(id, createdAt) {
  return {
    id,
    sig: 'b'.repeat(128),
    pubkey: 'a'.repeat(64),
    kind: 1,
    content: 'test',
    tags: [],
    created_at: createdAt,
  };
}

function harness() {
  const opened = [];
  const manager = new LiveSessionManager({
    mountedAt: 100,
    now: () => 120,
    sessionId: 'test-session',
    logger: () => {},
    openChannel(definition, onEvent, onClosed) {
      const record = { definition, onEvent, onClosed, closed: false };
      opened.push(record);
      return { close: () => { record.closed = true; } };
    },
  });
  return { manager, opened };
}

test('channels always inherit the original mount watermark', () => {
  const { manager, opened } = harness();
  manager.replaceChannel({
    id: 'owner-activity',
    filters: [{ authors: ['a'.repeat(64)], kinds: [1] }],
  });
  assert.equal(opened[0].definition.filters[0].since, 100);
});

test('historical and duplicate deliveries do not enter the live session', () => {
  const { manager, opened } = harness();
  const deliveries = [];
  manager.onDelivery((delivery) => deliveries.push(delivery));
  manager.replaceChannel({ id: 'owner-activity', filters: [{ kinds: [1] }] });

  opened[0].onEvent({ event: event('old', 99), relay: 'wss://one.example' });
  opened[0].onEvent({ event: event('new', 101), relay: 'wss://one.example' });
  opened[0].onEvent({ event: event('new', 101), relay: 'wss://two.example' });

  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].event.id, 'new');
  assert.equal(deliveries[0].sessionId, 'test-session');
});

test('replacing a channel closes it and ignores stale callbacks', () => {
  const { manager, opened } = harness();
  const deliveries = [];
  manager.onDelivery((delivery) => deliveries.push(delivery));
  manager.replaceChannel({ id: 'owner-activity', filters: [{ kinds: [1] }] });
  manager.replaceChannel({ id: 'owner-activity', filters: [{ kinds: [1] }] });

  assert.equal(opened[0].closed, true);
  opened[0].onEvent({ event: event('stale', 101), relay: 'wss://one.example' });
  opened[1].onEvent({ event: event('current', 101), relay: 'wss://one.example' });
  assert.deepEqual(deliveries.map((delivery) => delivery.event.id), ['current']);
});

test('destroy closes every active channel', () => {
  const { manager, opened } = harness();
  manager.replaceChannel({ id: 'owner-activity', filters: [{ kinds: [1] }] });
  manager.replaceChannel({ id: 'owner-habitat', filters: [{ kinds: [0] }] });
  manager.destroy();
  assert.equal(opened.every((channel) => channel.closed), true);
});

test('inbound engagement accepts an all-kinds p-tag filter', () => {
  const { manager, opened } = harness();
  const ownerPubkey = 'a'.repeat(64);
  manager.replaceChannel({
    id: 'inbound-engagement',
    filters: [{ '#p': [ownerPubkey] }],
  });
  assert.deepEqual(opened[0].definition.filters, [
    { '#p': [ownerPubkey], since: 100 },
  ]);
  assert.equal('kinds' in opened[0].definition.filters[0], false);
});
