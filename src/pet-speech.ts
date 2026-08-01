import type { PetCondition } from './pet-emotion';
import type { LiveAggregate } from './live-aggregation';

export type PetPersonality = 'gentle';
export type PetSpeechIntent = 'activity' | 'conversation' | 'gratitude';

export type PetUtterance = {
  id: string;
  intent: PetSpeechIntent;
  text: string;
  durationMs: number;
  priority: number;
};

export type PetSpeechSnapshot = {
  utterance: PetUtterance | null;
  queuedCount: number;
};

type ZapPhrase = (amount: string, actor: string) => string;

// The current pet ruleset is gentle-v1. Keeping the catalog keyed by personality
// makes additional voices additive instead of scattering copy through event handlers.
export const ZAP_PHRASES: Readonly<Record<PetPersonality, readonly ZapPhrase[]>> = {
  gentle: [
    (amount, actor) => `Oh! ${actor} sent ${amount} sats! Thank you so much!`,
    (amount, actor) => `${amount} sats of kindness from ${actor} just arrived!`,
    (amount, actor) => `A ${amount} sat zap from ${actor}! My heart feels warm.`,
    (amount, actor) => `${actor} sent ${amount} sats? That is so sweet!`,
    (amount, actor) => `${amount} sats from ${actor}! I will treasure this little spark.`,
    (amount, actor) => `${actor} zapped ${amount} sats! What a lovely surprise!`,
    (amount, actor) => `A warm ${amount} sat zap from ${actor} found its way here!`,
    (amount, actor) => `${amount} sats from ${actor}! Thank you for thinking of us.`,
    (amount, actor) => `${actor}'s ${amount} sat zap made my ears perk up!`,
    (amount, actor) => `${actor} sent ${amount} sats and brightened my whole habitat!`,
    (amount, actor) => `I felt ${actor}'s ${amount} sat zap all the way in my paws!`,
    (amount, actor) => `A ${amount} sat gift from ${actor}! May your day be gentle too.`,
    (amount, actor) => `${amount} sats from ${actor}? I am doing my happiest little dance!`,
    (amount, actor) => `Thank you, ${actor}, for the ${amount} sat lightning hug!`,
    (amount, actor) => `${amount} sats from ${actor} arrived with a tiny sparkle!`,
    (amount, actor) => `A ${amount} sat zap from ${actor}! You are very kind.`,
    (amount, actor) => `${actor} sent ${amount} sats! I feel extra cared for today.`,
    (amount, actor) => `What a cozy ${amount} sat surprise from ${actor}!`,
    (amount, actor) => `${amount} sats of pure encouragement from ${actor}! Thank you!`,
    (amount, actor) => `A ${amount} sat zap from ${actor} for us? I am beaming!`,
  ],
};

const LIVING_CONDITIONS: readonly PetCondition[] = [
  'happy', 'content', 'lonely', 'sick', 'critical',
];

export function speechForLiveAggregate(
  aggregate: LiveAggregate,
  personality: PetPersonality,
  actorName?: string,
): PetUtterance {
  const zap = aggregate.representativeSignal.zap;
  if ((aggregate.byType['zap-received'] ?? 0) > 0 && zap) {
    const phrases = ZAP_PHRASES[personality];
    const phrase = phrases[stableIndex(zap.zapRequestId, phrases.length)];
    return {
      id: `zap:${zap.zapRequestId}`,
      intent: 'gratitude',
      text: phrase(formatSats(zap.amountSats), actorName || 'someone'),
      durationMs: 3_800,
      priority: 80,
    };
  }
  if ((aggregate.byType['owner-published'] ?? 0) > 0) {
    return {
      id: `published:${aggregate.representativeSignal.eventId}`,
      intent: 'activity',
      text: aggregate.total > 1 ? 'So much activity! I feel energized!' : 'You posted! I feel energized!',
      durationMs: 3_200,
      priority: 40,
    };
  }
  return {
    id: `conversation:${aggregate.representativeSignal.eventId}`,
    intent: 'conversation',
    text: 'Making conversation? I love that!',
    durationMs: 3_200,
    priority: 30,
  };
}

function stableIndex(seed: string, length: number): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % length;
}

function formatSats(amount: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount);
}

export class PetSpeechController {
  private condition: PetCondition;
  private active: PetUtterance | null = null;
  private queue: PetUtterance[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(snapshot: PetSpeechSnapshot) => void>();
  private readonly schedule: typeof setTimeout;
  private readonly cancel: typeof clearTimeout;
  private readonly log: (message: string, details?: Record<string, unknown>) => void;

  constructor(options?: {
    condition?: PetCondition;
    schedule?: typeof setTimeout;
    cancel?: typeof clearTimeout;
    logger?: (message: string, details?: Record<string, unknown>) => void;
  }) {
    this.condition = options?.condition ?? 'happy';
    this.schedule = options?.schedule ?? setTimeout;
    this.cancel = options?.cancel ?? clearTimeout;
    this.log = options?.logger ?? ((message, details) => console.log(message, details ?? {}));
    this.log('[nappagochi:speech] controller created', { condition: this.condition });
  }

  setCondition(condition: PetCondition): void {
    this.condition = condition;
    if (condition === 'dead') this.clear('terminal-condition');
  }

  say(utterance: PetUtterance): boolean {
    if (!LIVING_CONDITIONS.includes(this.condition) || !utterance.text.trim()) {
      this.log('[nappagochi:speech] utterance rejected', {
        utteranceId: utterance.id, condition: this.condition,
      });
      return false;
    }
    if (!this.active || utterance.priority >= this.active.priority) {
      const interruptedId = this.active?.id ?? null;
      this.start(utterance);
      this.log('[nappagochi:speech] utterance started', {
        utteranceId: utterance.id, intent: utterance.intent,
        durationMs: utterance.durationMs, interruptedId,
      });
    } else {
      this.queue.push(utterance);
      this.log('[nappagochi:speech] utterance queued', {
        utteranceId: utterance.id, activeId: this.active.id, queuedCount: this.queue.length,
      });
      this.notify();
    }
    return true;
  }

  snapshot(): PetSpeechSnapshot {
    return { utterance: this.active, queuedCount: this.queue.length };
  }

  subscribe(listener: (snapshot: PetSpeechSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.clear('destroyed');
    this.listeners.clear();
  }

  private start(utterance: PetUtterance): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.active = utterance;
    this.timer = this.schedule(() => this.advance(), Math.max(500, utterance.durationMs));
    this.notify();
  }

  private advance(): void {
    const completedId = this.active?.id ?? null;
    this.timer = null;
    this.active = null;
    const next = this.queue.shift();
    this.log('[nappagochi:speech] utterance completed', {
      utteranceId: completedId, nextId: next?.id ?? null, queuedCount: this.queue.length,
    });
    if (next) this.start(next);
    else this.notify();
  }

  private clear(reason: string): void {
    if (this.timer !== null) this.cancel(this.timer);
    const hadSpeech = Boolean(this.active || this.queue.length);
    this.timer = null;
    this.active = null;
    this.queue = [];
    if (hadSpeech) {
      this.log('[nappagochi:speech] speech cleared', { reason });
      this.notify();
    }
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
