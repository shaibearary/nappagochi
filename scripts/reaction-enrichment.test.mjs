import assert from 'node:assert/strict';
import test from 'node:test';
import { ReactionMetadataLoader } from '../src/reaction-enrichment.ts';

test('rejected reactions never trigger metadata lookup', async () => {
  let lookups = 0;
  const loader = new ReactionMetadataLoader({
    lookupProfile: async () => { lookups += 1; return null; },
    logger: () => {},
  });
  const actor = await loader.enrichApprovedReaction({
    reactionAccepted: false, reactionId: 'notice', actorPubkey: 'a'.repeat(64),
  });
  assert.equal(actor, null);
  assert.equal(lookups, 0);
});

test('approved reactions resolve and sanitize actor metadata', async () => {
  const loader = new ReactionMetadataLoader({
    lookupProfile: async () => ({ displayName: '  Alice   Example  ', picture: 'http://unsafe.example/a.png' }),
    logger: () => {},
  });
  const actor = await loader.enrichApprovedReaction({
    reactionAccepted: true, reactionId: 'zap-celebrate', actorPubkey: 'a'.repeat(64),
  });
  assert.equal(actor.name, 'Alice Example');
  assert.equal(actor.picture, undefined);
});

test('profile requests are deduplicated and cached by pubkey', async () => {
  let lookups = 0;
  const loader = new ReactionMetadataLoader({
    lookupProfile: async () => { lookups += 1; return { name: 'Alice' }; },
    logger: () => {},
  });
  const request = { reactionAccepted: true, reactionId: 'zap-celebrate', actorPubkey: 'a'.repeat(64) };
  await Promise.all([loader.enrichApprovedReaction(request), loader.enrichApprovedReaction(request)]);
  await loader.enrichApprovedReaction(request);
  assert.equal(lookups, 1);
});

test('metadata lookup is time boxed and returns an anonymous actor', async () => {
  let timeout;
  const loader = new ReactionMetadataLoader({
    lookupProfile: () => new Promise(() => {}),
    timeoutMs: 100,
    logger: () => {},
    schedule: (callback) => { timeout = callback; return 1; },
    cancel: () => {},
  });
  const pending = loader.enrichApprovedReaction({
    reactionAccepted: true, reactionId: 'zap-celebrate', actorPubkey: 'a'.repeat(64),
  });
  timeout();
  assert.deepEqual(await pending, { pubkey: 'a'.repeat(64) });
});
