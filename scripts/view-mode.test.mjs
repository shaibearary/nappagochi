import assert from 'node:assert/strict';
import test from 'node:test';
import { nip19 } from 'nostr-tools';
import { isReadOnlyView, parseViewerNpub } from '../src/view-mode.ts';

const PUBKEY = '12'.repeat(32);
const OTHER_PUBKEY = '34'.repeat(32);

test('decodes a trimmed npub without accepting private-key input', () => {
  const npub = nip19.npubEncode(PUBKEY);
  assert.equal(parseViewerNpub(`  ${npub.toUpperCase()}  `), PUBKEY);
  assert.throws(
    () => parseViewerNpub(nip19.nsecEncode(new Uint8Array(32).fill(1))),
    /public npub/,
  );
  assert.throws(() => parseViewerNpub('npub1notvalid'), /not valid/);
});

test('view mode is read-only unless the target is the connected account', () => {
  assert.equal(isReadOnlyView('', PUBKEY), false);
  assert.equal(isReadOnlyView(PUBKEY, PUBKEY), false);
  assert.equal(isReadOnlyView(OTHER_PUBKEY, PUBKEY), true);
  assert.equal(isReadOnlyView(OTHER_PUBKEY, ''), true);
});
