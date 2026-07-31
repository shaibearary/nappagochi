import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HABITAT_SICK_AFTER_DAYS,
  applyHabitatSickness,
  reduceHabitatSickness,
} from '../src/habitat-sickness.ts';

const DAY = 86_400;
const NOW = 1_800_000_000;

test('an incomplete habitat receives a fourteen-day grace period', () => {
  const before = reduceHabitatSickness({
    incomplete: true,
    birthCreatedAt: NOW - (HABITAT_SICK_AFTER_DAYS - 1) * DAY,
    at: NOW,
  });
  assert.equal(before.sick, false);
  assert.equal(before.daysIncomplete, 13);
  assert.equal(before.daysUntilSick, 1);

  const due = reduceHabitatSickness({
    incomplete: true,
    birthCreatedAt: NOW - HABITAT_SICK_AFTER_DAYS * DAY,
    at: NOW,
  });
  assert.equal(due.sick, true);
  assert.equal(due.daysIncomplete, 14);
  assert.equal(due.daysUntilSick, 0);
});

test('a signed habitat change restarts the grace period', () => {
  const health = reduceHabitatSickness({
    incomplete: true,
    birthCreatedAt: NOW - 40 * DAY,
    lastHabitatChangeAt: NOW - 3 * DAY,
    at: NOW,
  });
  assert.equal(health.sick, false);
  assert.equal(health.riskSince, NOW - 3 * DAY);
  assert.equal(health.daysIncomplete, 3);
});

test('verified medicine keeps the existing recovery action', () => {
  const recovered = reduceHabitatSickness({
    incomplete: true,
    birthCreatedAt: NOW - 40 * DAY,
    lastMedicineAt: NOW,
    at: NOW,
  });
  assert.equal(recovered.sick, false);
  assert.equal(recovered.daysIncomplete, 0);

  const relapsed = reduceHabitatSickness({
    incomplete: true,
    birthCreatedAt: NOW - 40 * DAY,
    lastMedicineAt: NOW - HABITAT_SICK_AFTER_DAYS * DAY,
    at: NOW,
  });
  assert.equal(relapsed.sick, true);
});

test('a non-incomplete habitat never causes sickness', () => {
  const health = reduceHabitatSickness({
    incomplete: false,
    birthCreatedAt: NOW - 100 * DAY,
    at: NOW,
  });
  assert.equal(health.sick, false);
  assert.equal(health.daysIncomplete, 0);
});

test('habitat can cause Sick but cannot escalate activity to Critical or Dead', () => {
  assert.equal(applyHabitatSickness('happy', true), 'sick');
  assert.equal(applyHabitatSickness('content', true), 'sick');
  assert.equal(applyHabitatSickness('lonely', true), 'sick');
  assert.equal(applyHabitatSickness('critical', true), 'critical');
  assert.equal(applyHabitatSickness('dead', true), 'dead');
});
