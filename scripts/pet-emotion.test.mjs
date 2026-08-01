import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PET_REACTION_CLIPS,
  PetEmotionController,
  resolvePetPose,
} from '../src/pet-emotion.ts';

test('lifecycle condition establishes the authoritative pose', () => {
  const happy = resolvePetPose({ condition: 'happy' });
  const sick = resolvePetPose({ condition: 'sick' });
  const dead = resolvePetPose({ condition: 'dead', mood: 'joyful' });

  assert.ok(happy.mouthCurve > 0);
  assert.ok(sick.eyeOpen < happy.eyeOpen);
  assert.equal(dead.eyeOpen, 0);
  assert.equal(dead.mouthOpen, 0);
  assert.equal(dead.opacity, 0.78);
});

test('serious conditions dampen mood rather than being visually replaced by it', () => {
  const happyJoy = resolvePetPose({ condition: 'happy', mood: 'joyful' });
  const sickJoy = resolvePetPose({ condition: 'sick', mood: 'joyful' });

  assert.ok(happyJoy.eyeSmile > sickJoy.eyeSmile);
  assert.ok(sickJoy.eyeOpen < happyJoy.eyeOpen);
  assert.ok(sickJoy.saturation < happyJoy.saturation);
});

test('dead pets reject every temporary reaction', () => {
  let now = 100;
  const controller = new PetEmotionController({ condition: 'dead', now: () => now, logger: () => {} });

  for (const reaction of Object.keys(PET_REACTION_CLIPS)) {
    assert.equal(controller.react(reaction), false);
  }
  now += 1_000;
  assert.equal(controller.snapshot().reaction, null);
});

test('higher priority reactions interrupt lower priority reactions', () => {
  let now = 100;
  const controller = new PetEmotionController({ now: () => now, logger: () => {} });

  assert.equal(controller.react('notice'), true);
  assert.equal(controller.react('celebrate'), true);
  assert.equal(controller.snapshot().reaction, 'celebrate');
  assert.equal(controller.react('notice'), false);

  now += PET_REACTION_CLIPS.celebrate.durationMs;
  assert.equal(controller.snapshot().reaction, null);
  assert.equal(controller.react('notice'), true);
});

test('condition changes to dead cancel an active reaction', () => {
  const controller = new PetEmotionController({ condition: 'happy', now: () => 0, logger: () => {} });
  assert.equal(controller.react('celebrate'), true);
  controller.setCondition('dead');

  const snapshot = controller.snapshot();
  assert.equal(snapshot.condition, 'dead');
  assert.equal(snapshot.reaction, null);
  assert.equal(snapshot.pose.eyeOpen, 0);
});

test('reduced motion substitutes a static reaction pose', () => {
  const controller = new PetEmotionController({
    condition: 'happy',
    now: () => 100,
    reducedMotion: () => true,
    logger: () => {},
  });
  controller.react('tap-hop');

  const snapshot = controller.snapshot(250);
  assert.equal(snapshot.pose.bodyY, -2);
  assert.equal(snapshot.pose.eyeSmile, 0.8);
});

test('reaction keyframes begin from the authoritative baseline pose', () => {
  const baseline = resolvePetPose({ condition: 'happy' });
  const reactionStart = resolvePetPose({
    condition: 'happy',
    reaction: 'celebrate',
    reactionProgress: 0,
  });
  assert.equal(reactionStart.bodyScaleX, baseline.bodyScaleX);
  assert.equal(reactionStart.bodyScaleY, baseline.bodyScaleY);
  assert.equal(reactionStart.bodyY, baseline.bodyY);
});

test('zap celebration is available to every living condition but not death', () => {
  for (const condition of ['happy', 'content', 'lonely', 'sick', 'critical']) {
    const controller = new PetEmotionController({
      condition,
      now: () => 0,
      logger: () => {},
    });
    assert.equal(controller.react('zap-celebrate'), true);
  }
  const dead = new PetEmotionController({ condition: 'dead', now: () => 0, logger: () => {} });
  assert.equal(dead.react('zap-celebrate'), false);
});
