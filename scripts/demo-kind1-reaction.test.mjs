import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEvent } from 'nostr-tools';
import {
  classifyOwnerActivityDelivery,
  reactionForLiveAggregate,
} from '../src/live-aggregation.ts';
import { buildDemoKind1Event } from './demo-kind1-reaction.mjs';

test('the local fake event follows the signed Kind 1 to jumping-reaction path', () => {
  const secretKey = new Uint8Array(32).fill(21);
  const event = buildDemoKind1Event({
    secretKey,
    createdAt: 1_800_000_000,
  });
  const signal = classifyOwnerActivityDelivery({
    event,
    receivedAt: 1_800_000_001,
  });

  assert.equal(verifyEvent(event), true);
  assert.equal(event.kind, 1);
  assert.deepEqual(event.tags, []);
  assert.equal(signal?.type, 'owner-published');
  assert.equal(reactionForLiveAggregate({
    windowStartedAt: signal.receivedAt,
    windowEndedAt: signal.receivedAt,
    total: 1,
    actorCount: 1,
    byType: { 'owner-published': 1 },
    representativeSignal: signal,
  }), 'celebrate');
});
