import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreProfileChecks } from '../src/profile-scoring.ts';

test('unavailable checks are neutral and excluded from the score denominator', () => {
  const result = scoreProfileChecks([
    { point: true },
    { point: true },
    { point: false, assessed: false },
    { point: false, assessed: false },
  ]);
  assert.deepEqual(result, { score: 2, max: 2, tier: 'excellent' });
});

test('assessed failures still lower profile health', () => {
  const result = scoreProfileChecks([
    { point: true },
    { point: false },
    { point: false, assessed: true },
    { point: true },
  ]);
  assert.deepEqual(result, { score: 2, max: 4, tier: 'attention' });
});

test('an entirely unassessed profile fails closed', () => {
  const result = scoreProfileChecks([{ point: false, assessed: false }]);
  assert.deepEqual(result, { score: 0, max: 0, tier: 'incomplete' });
});
