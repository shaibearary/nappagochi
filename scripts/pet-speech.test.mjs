import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PetSpeechController,
  ZAP_PHRASES,
  speechForLiveAggregate,
} from '../src/pet-speech.ts';

function utterance(overrides = {}) {
  return { id: 'first', intent: 'activity', text: 'Hello!', durationMs: 1_000, priority: 20, ...overrides };
}

function controller(condition = 'happy') {
  const scheduled = [];
  const value = new PetSpeechController({
    condition,
    logger: () => {},
    schedule: (callback, delayMs) => {
      const timer = { callback, delayMs, cancelled: false };
      scheduled.push(timer);
      return timer;
    },
    cancel: (timer) => { timer.cancelled = true; },
  });
  return { scheduled, value };
}

test('gentle personality has twenty distinct zap phrases', () => {
  const rendered = ZAP_PHRASES.gentle.map((phrase) => phrase('100', 'Alice'));
  assert.equal(rendered.length, 20);
  assert.equal(new Set(rendered).size, 20);
});

test('the same zap deterministically selects the same phrase', () => {
  const aggregate = {
    windowStartedAt: 100, windowEndedAt: 101, total: 1, actorCount: 1,
    byType: { 'zap-received': 1 },
    representativeSignal: {
      id: 'zap', channelId: 'inbound-engagement', eventId: 'event', actorPubkey: 'actor',
      receivedAt: 101, eventCreatedAt: 100, type: 'zap-received',
      zap: { amountSats: 1_000, senderPubkey: 'sender', zapRequestId: 'request-id' },
    },
  };
  const first = speechForLiveAggregate(aggregate, 'gentle', 'Alice');
  const second = speechForLiveAggregate(aggregate, 'gentle', 'Alice');
  assert.equal(first.text, second.text);
  assert.match(first.text, /1,000/);
  assert.match(first.text, /Alice/);
});

test('speech is temporary and advances through its queue', () => {
  const { value, scheduled } = controller();
  value.say(utterance());
  value.say(utterance({ id: 'second', text: 'Next', priority: 10 }));
  assert.equal(value.snapshot().queuedCount, 1);
  scheduled[0].callback();
  assert.equal(value.snapshot().utterance?.id, 'second');
  scheduled[1].callback();
  assert.equal(value.snapshot().utterance, null);
});

test('higher priority speech interrupts active speech', () => {
  const { value, scheduled } = controller();
  value.say(utterance());
  value.say(utterance({ id: 'urgent', priority: 80 }));
  assert.equal(scheduled[0].cancelled, true);
  assert.equal(value.snapshot().utterance?.id, 'urgent');
});

test('dead pets cannot speak and terminal condition clears speech', () => {
  assert.equal(controller('dead').value.say(utterance()), false);
  const { value } = controller();
  value.say(utterance());
  value.setCondition('dead');
  assert.equal(value.snapshot().utterance, null);
});
