import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PetSoundController,
  soundCuesForReaction,
} from '../src/pet-sound.ts';

function fakeAudioContext(initialState = 'running') {
  const oscillators = [];
  let closed = false;
  let resumeCalls = 0;
  const parameter = () => ({
    calls: [],
    setValueAtTime(value, at) { this.calls.push(['set', value, at]); },
    exponentialRampToValueAtTime(value, at) { this.calls.push(['ramp', value, at]); },
  });
  return {
    currentTime: 10,
    state: initialState,
    destination: {},
    oscillators,
    get closed() { return closed; },
    get resumeCalls() { return resumeCalls; },
    createOscillator() {
      const oscillator = {
        type: 'sine',
        frequency: parameter(),
        starts: [],
        stops: [],
        connect() {},
        start(at) { this.starts.push(at); },
        stop(at) { this.stops.push(at); },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() {
      return { gain: parameter(), connect() {} };
    },
    resume() {
      resumeCalls += 1;
      if (this.state === 'suspended') return new Promise(() => {});
      return Promise.resolve();
    },
    async close() { closed = true; this.state = 'closed'; },
  };
}

test('post, reply, and zap reactions have distinct synchronized sound cues', () => {
  const post = soundCuesForReaction('celebrate');
  const reply = soundCuesForReaction('reply-roll');
  const zap = soundCuesForReaction('zap-celebrate');

  assert.equal(post.length, 3);
  assert.equal(reply.length, 3);
  assert.equal(zap.length, 4);
  assert.ok(post.at(-1).delayMs < reply.at(-1).delayMs);
  assert.ok(reply.at(-1).delayMs < zap.at(-1).delayMs);
  assert.deepEqual(soundCuesForReaction('notice'), []);
});

test('sound stays silent until the user enables it', async () => {
  let contextCreated = false;
  const controller = new PetSoundController({
    createContext: () => {
      contextCreated = true;
      return fakeAudioContext();
    },
    logger: () => {},
  });

  assert.equal(await controller.play('celebrate'), false);
  assert.equal(contextCreated, false);
});

test('enabled sound schedules every cue and disabling closes the context', async () => {
  const context = fakeAudioContext();
  const controller = new PetSoundController({
    createContext: () => context,
    logger: () => {},
  });
  controller.setEnabled(true, { unlock: false });

  assert.equal(await controller.play('reply-roll'), true);
  assert.equal(context.oscillators.length, soundCuesForReaction('reply-roll').length);
  assert.ok(context.oscillators.every((oscillator) => oscillator.starts.length === 1));

  controller.setEnabled(false);
  await Promise.resolve();
  assert.equal(context.closed, true);
});

test('a blocked audio context skips the reaction instead of playing it late', async () => {
  const context = fakeAudioContext('suspended');
  const controller = new PetSoundController({
    createContext: () => context,
    logger: () => {},
  });
  controller.setEnabled(true, { unlock: false });

  assert.equal(await controller.play('zap-celebrate'), false);
  assert.equal(context.oscillators.length, 0);
  assert.equal(context.resumeCalls, 1);
});
