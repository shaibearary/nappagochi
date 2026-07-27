import assert from 'node:assert/strict';
import test from 'node:test';
import { finalizeEvent, nip19, verifyEvent } from 'nostr-tools';
import {
  SCENARIOS,
  buildScenario,
  createPajaConfig,
  decodeNsec,
} from './create-pet-fixtures.mjs';

const NOW = 1_800_000_000;
const TEST_SECRET = new Uint8Array(32).fill(1);

test('every lifecycle fixture is signed and uses an isolated Paja memory relay', () => {
  for (const scenario of SCENARIOS) {
    const result = buildScenario({
      id: scenario.id,
      secretKey: TEST_SECRET,
      now: NOW,
    });
    const config = createPajaConfig(result);

    assert.equal(config.simulation.identity.mode, 'fixed');
    assert.equal(config.simulation.identity.pubkey, result.pubkey);
    assert.equal(config.simulation.relay.mode, 'memory');
    assert.equal(config.simulation.relay.fixtures, result.events);
    assert.ok(result.events.length >= 2);
    assert.ok(result.events.every((event) => verifyEvent(event)));
    assert.ok(
      result.events.some(
        (event) =>
          event.kind === 78 &&
          event.tags.some(
            (tag) => tag[0] === 'd' && tag[1] === 'nostr.pet.birth.v1',
          ),
      ),
    );
  }
});

test('activity scenarios place the last valid care event at the intended age', () => {
  for (const scenario of SCENARIOS.slice(0, 6)) {
    const result = buildScenario({
      id: scenario.id,
      secretKey: TEST_SECRET,
      now: NOW,
    });
    const ownerNotes = result.events.filter(
      (event) =>
        event.kind === 1 &&
        event.pubkey === result.pubkey &&
        event.tags.every((tag) => tag[0] !== 'e'),
    );
    const firstCare = ownerNotes[0];
    assert.ok(firstCare);
    assert.equal(NOW - firstCare.created_at, scenario.quietDays * 86_400);
  }
});

test('medicine fixture contains a verifiable other-author parent and owner reply', () => {
  const result = buildScenario({
    id: 'medicine-recovered',
    secretKey: TEST_SECRET,
    now: NOW,
  });
  const reply = result.events.find(
    (event) => event.pubkey === result.pubkey && event.tags.some((tag) => tag[0] === 'e'),
  );
  assert.ok(reply);
  const eventTag = reply.tags.find((tag) => tag[0] === 'e');
  const pubkeyTag = reply.tags.find((tag) => tag[0] === 'p');
  const parent = result.events.find((event) => event.id === eventTag?.[1]);
  assert.ok(parent);
  assert.equal(parent.kind, 1);
  assert.equal(parent.pubkey, pubkeyTag?.[1]);
  assert.notEqual(parent.pubkey, result.pubkey);
});

test('doctor fixtures cover public discovery and followed-account priority', () => {
  const happy = buildScenario({
    id: 'happy',
    secretKey: TEST_SECRET,
    now: NOW,
  });
  const discoveryNote = happy.events.find(
    (event) => event.kind === 1 && event.pubkey !== happy.pubkey,
  );
  assert.ok(discoveryNote);
  assert.equal(happy.events.some((event) => event.kind === 3 && event.pubkey === happy.pubkey), false);

  const content = buildScenario({
    id: 'content',
    secretKey: TEST_SECRET,
    now: NOW,
  });
  const contactList = content.events.find(
    (event) => event.kind === 3 && event.pubkey === content.pubkey,
  );
  const followedPubkey = contactList?.tags.find((tag) => tag[0] === 'p')?.[1];
  assert.ok(followedPubkey);
  assert.ok(
    content.events.some(
      (event) => event.kind === 1 && event.pubkey === followedPubkey,
    ),
  );
});

test('successor fixture references a predecessor born more than 45 days earlier', () => {
  const result = buildScenario({
    id: 'successor',
    secretKey: TEST_SECRET,
    now: NOW,
  });
  const births = result.events.filter((event) => event.kind === 78);
  assert.equal(births.length, 2);
  const predecessor = births[0];
  const successor = births[1];
  assert.equal(successor.tags.find((tag) => tag[0] === 'e')?.[1], predecessor.id);
  assert.ok(successor.created_at - predecessor.created_at >= 45 * 86_400);
});

test('nostr-tools test key remains usable after fixture generation', () => {
  const event = finalizeEvent(
    { kind: 1, created_at: NOW, tags: [], content: 'test' },
    TEST_SECRET,
  );
  assert.ok(verifyEvent(event));
});

test('the hidden-paste path decodes a valid nsec without changing it', () => {
  const nsec = nip19.nsecEncode(TEST_SECRET);
  assert.deepEqual(decodeNsec(nsec), TEST_SECRET);
  assert.throws(() => decodeNsec(nip19.npubEncode('00'.repeat(32))));
});
