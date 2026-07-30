import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptedRelayCount,
  mergeEventHistory,
  reduceActivityHealth,
  requireAcceptedPublishedEvent,
} from '../src/activity-reconciliation.ts';

const DAY = 86_400;
const OWNER = 'a'.repeat(64);

function event(overrides = {}) {
  return {
    id: 'b'.repeat(64),
    sig: 'c'.repeat(128),
    pubkey: OWNER,
    kind: 1,
    content: 'A real test note',
    tags: [],
    created_at: 1_800_000_000,
    ...overrides,
  };
}

test('an accepted top-level note immediately resets a three-day pulse', () => {
  const now = 1_800_000_000;
  const before = reduceActivityHealth({
    birthCreatedAt: now - 3 * DAY,
    ownerPubkey: OWNER,
    notes: [],
    verifiedMedicineIds: new Set(),
    at: now,
  });
  assert.equal(before.daysQuiet, 3);
  assert.equal(before.state, 'content');

  const published = event({ created_at: now });
  const after = reduceActivityHealth({
    birthCreatedAt: now - 3 * DAY,
    ownerPubkey: OWNER,
    notes: mergeEventHistory([], [published]),
    verifiedMedicineIds: new Set(),
    at: now,
  });
  assert.equal(after.daysQuiet, 0);
  assert.equal(after.state, 'happy');
  assert.equal(after.lastCareAt, now);
});

test('a kind 1 event with any e tag remains medicine-only activity', () => {
  const now = 1_800_000_000;
  const reply = event({
    created_at: now,
    tags: [['e', 'd'.repeat(64), 'wss://relay.example', 'root']],
  });
  const health = reduceActivityHealth({
    birthCreatedAt: now - 3 * DAY,
    ownerPubkey: OWNER,
    notes: [reply],
    verifiedMedicineIds: new Set(),
    at: now,
  });
  assert.equal(health.daysQuiet, 3);
  assert.equal(health.state, 'content');
});

test('keeps the accepted event when a following relay query is stale', () => {
  const accepted = event();
  const staleRelayResult = [];
  assert.deepEqual(mergeEventHistory([accepted], staleRelayResult), [accepted]);
  assert.deepEqual(mergeEventHistory([accepted], [accepted]), [accepted]);
});

test('requires a signed event from the connected account before reporting success', () => {
  const signed = event();
  assert.equal(
    requireAcceptedPublishedEvent(
      {
        ok: true,
        event: signed,
        eventId: signed.id,
        relays: { 'ws://127.0.0.1:7777': true },
      },
      { ownerPubkey: OWNER, kind: 1 },
    ),
    signed,
  );
  assert.throws(
    () =>
      requireAcceptedPublishedEvent(
        { ok: true, relays: { 'ws://127.0.0.1:7777': true } },
        { ownerPubkey: OWNER, kind: 1 },
      ),
    /did not return a signed event/,
  );
  assert.throws(
    () =>
      requireAcceptedPublishedEvent(
        { ok: true, event: event({ pubkey: 'd'.repeat(64) }) },
        { ownerPubkey: OWNER, kind: 1 },
    ),
    /different account/,
  );
  assert.throws(
    () =>
      requireAcceptedPublishedEvent(
        {
          ok: false,
          event: signed,
          eventId: signed.id,
          error: 'relay rejected the event',
        },
        { ownerPubkey: OWNER, kind: 1 },
      ),
    /relay rejected the event/,
  );
  assert.throws(
    () =>
      requireAcceptedPublishedEvent(
        {
          ok: true,
          event: event({ sig: '' }),
        },
        { ownerPubkey: OWNER, kind: 1 },
      ),
    /invalid signed event/,
  );
});

test('counts only relays that accepted the event', () => {
  assert.equal(
    acceptedRelayCount({
      ok: true,
      relays: {
        'wss://one.example': true,
        'wss://two.example': false,
        'wss://three.example': true,
      },
    }),
    2,
  );
});
