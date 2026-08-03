import type { CommonProfileData } from '@napplet/sdk';

export type ReactionActor = {
  pubkey: string;
  name?: string;
  picture?: string;
};

type CachedActor = {
  actor: ReactionActor;
  expiresAt: number;
};

export class ReactionMetadataLoader {
  private readonly cache = new Map<string, CachedActor>();
  private readonly inFlight = new Map<string, Promise<ReactionActor>>();
  private readonly lookupProfile: (pubkey: string) => Promise<CommonProfileData | null>;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private readonly schedule: typeof setTimeout;
  private readonly cancel: typeof clearTimeout;
  private readonly log: (message: string, details?: Record<string, unknown>) => void;

  constructor(options: {
    lookupProfile: (pubkey: string) => Promise<CommonProfileData | null>;
    timeoutMs?: number;
    cacheTtlMs?: number;
    now?: () => number;
    schedule?: typeof setTimeout;
    cancel?: typeof clearTimeout;
    logger?: (message: string, details?: Record<string, unknown>) => void;
  }) {
    this.lookupProfile = options.lookupProfile;
    this.timeoutMs = Math.max(100, options.timeoutMs ?? 900);
    this.cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? 10 * 60_000);
    this.now = options.now ?? Date.now;
    // Preserve Window as the receiver in browser sandboxes.
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((timer) => clearTimeout(timer));
    this.log = options.logger ?? ((message, details) => console.log(message, details ?? {}));
  }

  async enrichApprovedReaction(input: {
    reactionAccepted: boolean;
    reactionId: string;
    actorPubkey?: string;
  }): Promise<ReactionActor | null> {
    if (!input.reactionAccepted || !input.actorPubkey) {
      this.log('[nappagochi:enrichment] metadata lookup skipped', {
        reactionId: input.reactionId,
        reactionAccepted: input.reactionAccepted,
        hasActor: Boolean(input.actorPubkey),
      });
      return null;
    }

    const cached = this.cache.get(input.actorPubkey);
    if (cached && cached.expiresAt > this.now()) {
      this.log('[nappagochi:enrichment] metadata cache hit', {
        reactionId: input.reactionId,
        actorPubkey: input.actorPubkey,
        hasName: Boolean(cached.actor.name),
      });
      return cached.actor;
    }

    this.log('[nappagochi:enrichment] approved reaction metadata lookup started', {
      reactionId: input.reactionId,
      actorPubkey: input.actorPubkey,
      timeoutMs: this.timeoutMs,
    });
    const lookup = this.inFlight.get(input.actorPubkey) ?? this.startLookup(input.actorPubkey);
    try {
      const actor = await this.withTimeout(lookup);
      this.log('[nappagochi:enrichment] metadata lookup completed', {
        reactionId: input.reactionId,
        actorPubkey: input.actorPubkey,
        hasName: Boolean(actor.name),
        hasPicture: Boolean(actor.picture),
      });
      return actor;
    } catch (error) {
      this.log('[nappagochi:enrichment] metadata lookup ended without enrichment', {
        reactionId: input.reactionId,
        actorPubkey: input.actorPubkey,
        reason: error instanceof Error ? error.message : 'lookup-failed',
      });
      return { pubkey: input.actorPubkey };
    }
  }

  private startLookup(pubkey: string): Promise<ReactionActor> {
    const lookup = this.lookupProfile(pubkey)
      .then((profile) => {
        const actor: ReactionActor = {
          pubkey,
          name: safeName(profile?.displayName) || safeName(profile?.name) || undefined,
          picture: safePicture(profile?.picture),
        };
        this.cache.set(pubkey, { actor, expiresAt: this.now() + this.cacheTtlMs });
        return actor;
      })
      .finally(() => this.inFlight.delete(pubkey));
    this.inFlight.set(pubkey, lookup);
    return lookup;
  }

  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = this.schedule(() => reject(new Error('metadata-timeout')), this.timeoutMs);
      promise.then(
        (value) => {
          this.cancel(timer);
          resolve(value);
        },
        (error) => {
          this.cancel(timer);
          reject(error);
        },
      );
    });
  }
}

function safeName(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, 40) : '';
}

function safePicture(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
