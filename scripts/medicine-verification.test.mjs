import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMedicineVerificationBatch,
  verifiedMedicineReplyIds,
} from '../src/medicine-verification.ts';

const OWNER = 'a'.repeat(64);
const PARENT_AUTHOR = 'b'.repeat(64);
const PARENT_ID = 'c'.repeat(64);

function event(overrides = {}) {
  return {
    id: 'd'.repeat(64),
    sig: 'e'.repeat(128),
    pubkey: OWNER,
    kind: 1,
    content: 'test',
    tags: [],
    created_at: 1_800_000_000,
    ...overrides,
  };
}

test('deduplicates repeated reply parents into one startup query', () => {
  const first = event({
    id: '1'.repeat(64),
    tags: [
      ['e', PARENT_ID, 'wss://one.example', 'reply'],
      ['p', PARENT_AUTHOR],
    ],
  });
  const second = event({
    id: '2'.repeat(64),
    created_at: first.created_at - 1,
    tags: [
      ['e', PARENT_ID, '', 'reply'],
      ['p', PARENT_AUTHOR],
    ],
  });
  const batch = buildMedicineVerificationBatch([first, second], OWNER);

  assert.equal(batch.filters.length, 1);
  assert.equal(batch.targets.length, 1);
  assert.deepEqual(batch.targets[0].replyIds, [first.id, second.id]);
  assert.deepEqual(batch.filters[0].ids, [PARENT_ID]);
  assert.deepEqual(batch.filters[0].authors, [PARENT_AUTHOR]);
  assert.deepEqual(batch.relays, ['wss://one.example']);
});

test('batches different parents and accepts only exact verified authors', () => {
  const secondParentId = 'f'.repeat(64);
  const secondAuthor = '9'.repeat(64);
  const firstReply = event({
    id: '1'.repeat(64),
    tags: [['e', PARENT_ID], ['p', PARENT_AUTHOR]],
  });
  const secondReply = event({
    id: '2'.repeat(64),
    tags: [['e', secondParentId], ['p', secondAuthor]],
  });
  const batch = buildMedicineVerificationBatch([firstReply, secondReply], OWNER);
  const accepted = verifiedMedicineReplyIds(
    batch,
    [
      event({ id: PARENT_ID, pubkey: PARENT_AUTHOR }),
      event({ id: secondParentId, pubkey: '8'.repeat(64) }),
    ],
    OWNER,
  );

  assert.equal(batch.filters.length, 1);
  assert.equal(batch.targets.length, 2);
  assert.deepEqual([...accepted], [firstReply.id]);
});

test('returns no query when there are no valid owner replies', () => {
  const batch = buildMedicineVerificationBatch([
    event({ pubkey: '7'.repeat(64), tags: [['e', PARENT_ID], ['p', PARENT_AUTHOR]] }),
    event({ tags: [] }),
  ], OWNER);
  assert.deepEqual(batch, { filters: [], authors: [], relays: [], targets: [] });
});
