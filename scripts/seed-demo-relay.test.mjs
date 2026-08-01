import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEvent } from 'nostr-tools';
import { SCENARIOS } from './create-pet-fixtures.mjs';
import {
  buildDemoManifest,
  buildDemoMatrix,
  requireLoopbackRelay,
} from './seed-demo-relay.mjs';

const NOW = 1_800_000_000;
const TEST_KEYS = SCENARIOS.map((_, index) => new Uint8Array(32).fill(index + 1));

test('builds one unique signed demo owner for every lifecycle scenario', () => {
  const results = buildDemoMatrix({ now: NOW, secretKeys: TEST_KEYS });
  assert.equal(results.length, SCENARIOS.length);
  assert.equal(new Set(results.map((result) => result.pubkey)).size, SCENARIOS.length);
  for (const result of results) {
    assert.ok(result.events.every((event) => verifyEvent(event)));
    assert.ok(result.events.some((event) => event.kind === 78));
    assert.ok(result.events.some((event) => event.kind === 1));
  }
});

test('writes a public-only manifest with copyable npubs', () => {
  const results = buildDemoMatrix({ now: NOW, secretKeys: TEST_KEYS });
  const manifest = buildDemoManifest(results, { now: NOW });
  assert.equal(manifest.accounts.length, SCENARIOS.length);
  assert.ok(manifest.accounts.every((account) => account.npub.startsWith('npub1')));
  assert.ok(manifest.accounts.every((account) => account.birthEventId.length === 64));
  const serialized = JSON.stringify(manifest);
  assert.equal(serialized.includes('nsec1'), false);
  assert.equal(serialized.includes('secretKey'), false);
});

test('refuses to seed any non-loopback or secure public relay', () => {
  assert.equal(requireLoopbackRelay('ws://127.0.0.1:7777/path'), 'ws://127.0.0.1:7777');
  assert.equal(requireLoopbackRelay('ws://localhost:7777'), 'ws://localhost:7777');
  assert.throws(() => requireLoopbackRelay('wss://nos.lol'), /only to a local/);
  assert.throws(() => requireLoopbackRelay('ws://192.168.1.5:7777'), /only to a local/);
});
