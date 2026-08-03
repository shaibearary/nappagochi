import type { ActivityState } from './activity-reconciliation';

export type PetCondition = ActivityState;

export type PetMood =
  | 'neutral'
  | 'calm'
  | 'joyful'
  | 'curious'
  | 'worried'
  | 'tired'
  | 'proud';

export type PetReaction =
  | 'notice'
  | 'tap-hop'
  | 'celebrate'
  | 'reply-roll'
  | 'startled'
  | 'receive-care'
  | 'recover'
  | 'zap-celebrate';

export type PetPose = {
  bodyY: number;
  bodyRotation: number;
  bodyScaleX: number;
  bodyScaleY: number;
  headTilt: number;
  eyeOpen: number;
  eyeSmile: number;
  browTilt: number;
  mouthOpen: number;
  mouthCurve: number;
  earDroop: number;
  cheekIntensity: number;
  saturation: number;
  opacity: number;
};

export type PetPoseKeyframe = {
  offset: number;
  pose: Partial<PetPose>;
};

export type PetAnimationClip = {
  id: PetReaction;
  durationMs: number;
  priority: number;
  allowedConditions: readonly PetCondition[];
  keyframes: readonly PetPoseKeyframe[];
  reducedMotionPose?: Partial<PetPose>;
};

export type PetEmotionSnapshot = {
  condition: PetCondition;
  mood: PetMood;
  reaction: PetReaction | null;
  pose: PetPose;
};

const LIVING_CONDITIONS: readonly PetCondition[] = [
  'happy',
  'content',
  'lonely',
  'sick',
  'critical',
];

export const NEUTRAL_PET_POSE: Readonly<PetPose> = {
  bodyY: 0,
  bodyRotation: 0,
  bodyScaleX: 1,
  bodyScaleY: 1,
  headTilt: 0,
  eyeOpen: 1,
  eyeSmile: 0,
  browTilt: 0,
  mouthOpen: 0,
  mouthCurve: 0.2,
  earDroop: 0,
  cheekIntensity: 1,
  saturation: 1,
  opacity: 1,
};

const CONDITION_POSES: Record<PetCondition, Partial<PetPose>> = {
  happy: { bodyY: -2, eyeSmile: 0.8, mouthCurve: 1, cheekIntensity: 1 },
  content: { eyeOpen: 0.9, eyeSmile: 0.25, mouthCurve: 0.35, cheekIntensity: 0.8 },
  lonely: { bodyY: 2, headTilt: -3, eyeOpen: 0.72, browTilt: -0.25, mouthCurve: -0.25, earDroop: 0.3 },
  sick: { bodyY: 4, headTilt: -4, eyeOpen: 0.48, browTilt: -0.45, mouthCurve: -0.5, earDroop: 0.6, cheekIntensity: 0.35, saturation: 0.72 },
  critical: { bodyY: 7, bodyRotation: -1.5, eyeOpen: 0.24, browTilt: -0.7, mouthCurve: -0.7, earDroop: 0.85, cheekIntensity: 0.15, saturation: 0.45 },
  dead: { bodyY: 13, bodyRotation: -3, eyeOpen: 0, eyeSmile: 0, mouthOpen: 0, mouthCurve: 0, earDroop: 1, cheekIntensity: 0, saturation: 0.2, opacity: 0.78 },
};

const MOOD_POSES: Record<PetMood, Partial<PetPose>> = {
  neutral: {},
  calm: { eyeOpen: 0.82, eyeSmile: 0.2, mouthCurve: 0.25, earDroop: 0.08 },
  joyful: { bodyY: -3, eyeOpen: 0.85, eyeSmile: 1, mouthOpen: 0.15, mouthCurve: 1, cheekIntensity: 1 },
  curious: { headTilt: 7, eyeOpen: 1.08, browTilt: 0.25, mouthCurve: 0.15 },
  worried: { headTilt: -3, eyeOpen: 0.78, browTilt: -0.5, mouthCurve: -0.35, earDroop: 0.35 },
  tired: { bodyY: 2, eyeOpen: 0.5, mouthCurve: -0.1, earDroop: 0.4 },
  proud: { bodyY: -1, headTilt: 3, eyeOpen: 0.88, eyeSmile: 0.55, mouthCurve: 0.7 },
};

export const PET_REACTION_CLIPS: Readonly<Record<PetReaction, PetAnimationClip>> = {
  notice: {
    id: 'notice',
    durationMs: 480,
    priority: 10,
    allowedConditions: LIVING_CONDITIONS,
    keyframes: [
      { offset: 0, pose: {} },
      { offset: 0.35, pose: { headTilt: 6, eyeOpen: 1.15, earDroop: 0 } },
      { offset: 1, pose: {} },
    ],
    reducedMotionPose: { eyeOpen: 1.08 },
  },
  'tap-hop': {
    id: 'tap-hop',
    durationMs: 620,
    priority: 20,
    allowedConditions: ['happy', 'content', 'lonely'],
    keyframes: [
      { offset: 0, pose: {} },
      { offset: 0.35, pose: { bodyY: -13, bodyScaleX: 0.94, bodyScaleY: 1.07, eyeSmile: 0.8 } },
      { offset: 0.7, pose: { bodyY: 1, bodyScaleX: 1.04, bodyScaleY: 0.96 } },
      { offset: 1, pose: {} },
    ],
    reducedMotionPose: { eyeSmile: 0.8 },
  },
  celebrate: {
    id: 'celebrate',
    // A top-level Kind 1 note gets a quick, unmistakable jump.
    // CSS moves the complete pet while this clip supplies expression and shape.
    durationMs: 1_050,
    priority: 30,
    allowedConditions: ['happy', 'content', 'lonely'],
    keyframes: [
      { offset: 0, pose: {} },
      { offset: 0.1, pose: { bodyY: 5, bodyScaleX: 1.1, bodyScaleY: 0.9, eyeOpen: 1.08, mouthOpen: 0.2 } },
      { offset: 0.24, pose: { bodyY: -9, bodyScaleX: 0.94, bodyScaleY: 1.08, eyeSmile: 1, mouthOpen: 0.55, mouthCurve: 1 } },
      { offset: 0.7, pose: { bodyY: -6, eyeSmile: 1, mouthOpen: 0.45, mouthCurve: 1, cheekIntensity: 1 } },
      { offset: 0.9, pose: { bodyY: 2, bodyScaleX: 1.08, bodyScaleY: 0.92, eyeSmile: 0.8 } },
      { offset: 1, pose: {} },
    ],
    reducedMotionPose: { eyeOpen: 1.08, eyeSmile: 1, mouthOpen: 0.45, mouthCurve: 1, cheekIntensity: 1 },
  },
  'reply-roll': {
    id: 'reply-roll',
    durationMs: 1_800,
    priority: 50,
    allowedConditions: LIVING_CONDITIONS,
    keyframes: [
      { offset: 0, pose: {} },
      { offset: 0.1, pose: { bodyY: 4, bodyScaleX: 1.08, bodyScaleY: 0.92, eyeOpen: 1.08 } },
      { offset: 0.28, pose: { bodyY: -9, bodyScaleX: 0.95, bodyScaleY: 1.05, eyeSmile: 0.9, mouthCurve: 1 } },
      { offset: 0.68, pose: { bodyY: -7, eyeSmile: 1, mouthCurve: 1, cheekIntensity: 1 } },
      { offset: 0.9, pose: { bodyY: 3, bodyScaleX: 1.1, bodyScaleY: 0.9 } },
      { offset: 1, pose: {} },
    ],
    reducedMotionPose: { eyeSmile: 0.9, mouthCurve: 1, cheekIntensity: 1 },
  },
  startled: {
    id: 'startled',
    durationMs: 420,
    priority: 40,
    allowedConditions: LIVING_CONDITIONS,
    keyframes: [
      { offset: 0, pose: {} },
      { offset: 0.3, pose: { bodyY: -5, bodyScaleX: 0.96, bodyScaleY: 1.04, eyeOpen: 1.2, mouthOpen: 0.5 } },
      { offset: 1, pose: {} },
    ],
    reducedMotionPose: { eyeOpen: 1.15, mouthOpen: 0.3 },
  },
  'receive-care': {
    id: 'receive-care',
    durationMs: 1000,
    priority: 60,
    allowedConditions: LIVING_CONDITIONS,
    keyframes: [
      { offset: 0, pose: {} },
      { offset: 0.45, pose: { eyeOpen: 0.75, eyeSmile: 0.75, mouthCurve: 0.65, cheekIntensity: 1 } },
      { offset: 1, pose: {} },
    ],
    reducedMotionPose: { eyeSmile: 0.65, mouthCurve: 0.55 },
  },
  recover: {
    id: 'recover',
    durationMs: 1400,
    priority: 80,
    allowedConditions: ['happy', 'content', 'lonely'],
    keyframes: [
      { offset: 0, pose: { bodyY: 4, eyeOpen: 0.5, earDroop: 0.6, saturation: 0.7 } },
      { offset: 0.65, pose: { bodyY: -8, eyeOpen: 0.9, eyeSmile: 0.8, mouthCurve: 0.8, earDroop: 0, saturation: 1 } },
      { offset: 1, pose: {} },
    ],
    reducedMotionPose: { eyeSmile: 0.7, mouthCurve: 0.7, saturation: 1 },
  },
  'zap-celebrate': {
    id: 'zap-celebrate',
    durationMs: 2_400,
    priority: 70,
    allowedConditions: LIVING_CONDITIONS,
    keyframes: [
      { offset: 0, pose: {} },
      { offset: 0.08, pose: { bodyY: -4, eyeOpen: 1.12, mouthOpen: 0.3, mouthCurve: 1 } },
      { offset: 0.36, pose: { bodyY: -3, eyeSmile: 1, mouthOpen: 0.25, mouthCurve: 1 } },
      { offset: 0.78, pose: { bodyY: -2, eyeSmile: 1, mouthCurve: 1, cheekIntensity: 1 } },
      { offset: 1, pose: {} },
    ],
    reducedMotionPose: { eyeSmile: 1, mouthOpen: 0.2, mouthCurve: 1, cheekIntensity: 1 },
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function mergePose(base: PetPose, overrides: Partial<PetPose>): PetPose {
  return { ...base, ...overrides };
}

function blendPose(base: PetPose, target: Partial<PetPose>, weight: number): PetPose {
  const result = { ...base };
  for (const key of Object.keys(target) as Array<keyof PetPose>) {
    const targetValue = target[key];
    if (targetValue !== undefined) result[key] += (targetValue - result[key]) * weight;
  }
  return result;
}

function moodWeight(condition: PetCondition): number {
  if (condition === 'dead') return 0;
  if (condition === 'critical') return 0.2;
  if (condition === 'sick') return 0.35;
  if (condition === 'lonely') return 0.65;
  return 1;
}

function sampleClip(
  clip: PetAnimationClip,
  progress: number,
  baseline: PetPose,
): Partial<PetPose> {
  const bounded = clamp(progress, 0, 1);
  let left = clip.keyframes[0];
  let right = clip.keyframes[clip.keyframes.length - 1];
  for (let index = 1; index < clip.keyframes.length; index += 1) {
    if (bounded <= clip.keyframes[index].offset) {
      right = clip.keyframes[index];
      left = clip.keyframes[index - 1];
      break;
    }
  }
  const span = Math.max(0.0001, right.offset - left.offset);
  const localProgress = clamp((bounded - left.offset) / span, 0, 1);
  const keys = new Set<keyof PetPose>([
    ...(Object.keys(left.pose) as Array<keyof PetPose>),
    ...(Object.keys(right.pose) as Array<keyof PetPose>),
  ]);
  const sampled: Partial<PetPose> = {};
  for (const key of keys) {
    const from = left.pose[key] ?? baseline[key];
    const to = right.pose[key] ?? baseline[key];
    sampled[key] = from + (to - from) * localProgress;
  }
  return sampled;
}

export function resolvePetPose(input: {
  condition: PetCondition;
  mood?: PetMood;
  reaction?: PetReaction;
  reactionProgress?: number;
  reducedMotion?: boolean;
}): PetPose {
  const mood = input.mood ?? 'neutral';
  let pose = mergePose({ ...NEUTRAL_PET_POSE }, CONDITION_POSES[input.condition]);
  pose = blendPose(pose, MOOD_POSES[mood], moodWeight(input.condition));

  if (input.reaction) {
    const clip = PET_REACTION_CLIPS[input.reaction];
    if (clip.allowedConditions.includes(input.condition)) {
      const reactionPose = input.reducedMotion
        ? clip.reducedMotionPose ?? {}
        : sampleClip(clip, input.reactionProgress ?? 0, pose);
      pose = mergePose(pose, reactionPose);
    }
  }

  return pose;
}

type ActiveReaction = {
  id: PetReaction;
  startedAt: number;
};

export class PetEmotionController {
  private condition: PetCondition;
  private mood: PetMood = 'neutral';
  private activeReaction: ActiveReaction | null = null;
  private readonly now: () => number;
  private readonly reducedMotion: () => boolean;
  private listeners = new Set<(snapshot: PetEmotionSnapshot) => void>();
  private readonly log: (message: string, details?: Record<string, unknown>) => void;

  constructor(options?: {
    condition?: PetCondition;
    now?: () => number;
    reducedMotion?: () => boolean;
    logger?: (message: string, details?: Record<string, unknown>) => void;
  }) {
    this.condition = options?.condition ?? 'happy';
    this.now = options?.now ?? (() => performance.now());
    this.reducedMotion = options?.reducedMotion ?? (() => false);
    this.log = options?.logger ?? ((message, details) => console.log(message, details ?? {}));
    this.log('[nappagochi:emotion] controller created', { condition: this.condition });
  }

  setCondition(condition: PetCondition): void {
    const previous = this.condition;
    this.condition = condition;
    if (condition === 'dead' && this.activeReaction) {
      this.log('[nappagochi:emotion] reaction cancelled by terminal condition', {
        reaction: this.activeReaction.id,
      });
      this.activeReaction = null;
    }
    if (previous !== condition) {
      this.log('[nappagochi:emotion] condition changed', { previous, condition });
    }
    this.notify();
  }

  setMood(mood: PetMood): void {
    const previous = this.mood;
    this.mood = mood;
    if (previous !== mood) this.log('[nappagochi:emotion] mood changed', { previous, mood });
    this.notify();
  }

  react(reaction: PetReaction): boolean {
    const clip = PET_REACTION_CLIPS[reaction];
    if (!clip.allowedConditions.includes(this.condition)) {
      this.log('[nappagochi:emotion] reaction rejected by condition', {
        reaction,
        condition: this.condition,
      });
      return false;
    }
    if (
      this.activeReaction &&
      PET_REACTION_CLIPS[this.activeReaction.id].priority > clip.priority &&
      !this.reactionFinished(this.activeReaction)
    ) {
      this.log('[nappagochi:emotion] reaction rejected by priority', {
        reaction,
        activeReaction: this.activeReaction.id,
        requestedPriority: clip.priority,
        activePriority: PET_REACTION_CLIPS[this.activeReaction.id].priority,
      });
      return false;
    }
    const interruptedReaction = this.activeReaction?.id ?? null;
    this.activeReaction = { id: reaction, startedAt: this.now() };
    this.log('[nappagochi:emotion] reaction started', {
      reaction,
      condition: this.condition,
      durationMs: clip.durationMs,
      priority: clip.priority,
      interruptedReaction,
      reducedMotion: this.reducedMotion(),
    });
    this.notify();
    return true;
  }

  cancelReaction(reaction?: PetReaction): void {
    if (!reaction || this.activeReaction?.id === reaction) {
      const cancelledReaction = this.activeReaction?.id ?? null;
      this.activeReaction = null;
      if (cancelledReaction) {
        this.log('[nappagochi:emotion] reaction cancelled', { reaction: cancelledReaction });
      }
      this.notify();
    }
  }

  snapshot(at = this.now()): PetEmotionSnapshot {
    if (this.activeReaction && this.reactionFinished(this.activeReaction, at)) {
      this.log('[nappagochi:emotion] reaction completed', {
        reaction: this.activeReaction.id,
        condition: this.condition,
      });
      this.activeReaction = null;
    }
    const reaction = this.activeReaction?.id ?? null;
    const clip = reaction ? PET_REACTION_CLIPS[reaction] : null;
    const reactionProgress = clip && this.activeReaction
      ? (at - this.activeReaction.startedAt) / clip.durationMs
      : 0;
    return {
      condition: this.condition,
      mood: this.mood,
      reaction,
      pose: resolvePetPose({
        condition: this.condition,
        mood: this.mood,
        reaction: reaction ?? undefined,
        reactionProgress,
        reducedMotion: this.reducedMotion(),
      }),
    };
  }

  subscribe(listener: (snapshot: PetEmotionSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.log('[nappagochi:emotion] controller destroyed', {
      activeReaction: this.activeReaction?.id ?? null,
      listenerCount: this.listeners.size,
    });
    this.activeReaction = null;
    this.listeners.clear();
  }

  private reactionFinished(reaction: ActiveReaction, at = this.now()): boolean {
    return at - reaction.startedAt >= PET_REACTION_CLIPS[reaction.id].durationMs;
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export function petPoseStyle(pose: PetPose): string {
  return [
    `--pet-pose-body-y:${pose.bodyY.toFixed(2)}px`,
    `--pet-pose-body-rotation:${pose.bodyRotation.toFixed(2)}deg`,
    `--pet-pose-scale-x:${pose.bodyScaleX.toFixed(3)}`,
    `--pet-pose-scale-y:${pose.bodyScaleY.toFixed(3)}`,
    `--pet-pose-head-tilt:${pose.headTilt.toFixed(2)}deg`,
    `--pet-pose-eye-open:${pose.eyeOpen.toFixed(3)}`,
    `--pet-pose-mouth-open:${pose.mouthOpen.toFixed(3)}`,
    `--pet-pose-ear-droop-angle:${(pose.earDroop * 12).toFixed(2)}deg`,
    `--pet-pose-cheek:${pose.cheekIntensity.toFixed(3)}`,
  ].join(';');
}
