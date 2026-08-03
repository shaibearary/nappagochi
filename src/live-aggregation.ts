import type { PetReaction } from './pet-emotion';
import type { NostrEvent } from '@napplet/sdk';
import { validateEvent, verifyEvent, type Event as ToolsEvent } from 'nostr-tools/pure';
import type { LiveChannelId } from './live-session';

export type PetLiveSignalType = 'owner-published' | 'owner-replied' | 'zap-received';

export type PetLiveSignal = {
  id: string;
  channelId: LiveChannelId;
  eventId: string;
  actorPubkey: string;
  receivedAt: number;
  eventCreatedAt: number;
  type: PetLiveSignalType;
  zap?: ParsedZapReceipt;
};

export type ParsedZapReceipt = {
  amountSats: number;
  senderPubkey: string;
  zapRequestId: string;
};

export type LiveAggregate = {
  windowStartedAt: number;
  windowEndedAt: number;
  total: number;
  actorCount: number;
  byType: Partial<Record<PetLiveSignalType, number>>;
  representativeSignal: PetLiveSignal;
};

export function classifyOwnerActivityDelivery(input: {
  event: NostrEvent;
  receivedAt: number;
}): PetLiveSignal | null {
  if (input.event.kind !== 1) return null;
  return {
    id: `owner-activity:${input.event.id}`,
    channelId: 'owner-activity',
    eventId: input.event.id,
    actorPubkey: input.event.pubkey,
    receivedAt: input.receivedAt,
    eventCreatedAt: input.event.created_at,
    type: input.event.tags.some((tag) => tag[0] === 'e')
      ? 'owner-replied'
      : 'owner-published',
  };
}

export function classifyInboundDelivery(input: {
  event: NostrEvent;
  ownerPubkey: string;
  receivedAt: number;
}): PetLiveSignal | null {
  const zap = parseZapReceipt(input.event, input.ownerPubkey);
  if (!zap) return null;
  return {
    id: `inbound-engagement:${input.event.id}`,
    channelId: 'inbound-engagement',
    eventId: input.event.id,
    actorPubkey: input.event.pubkey,
    receivedAt: input.receivedAt,
    eventCreatedAt: input.event.created_at,
    type: 'zap-received',
    zap,
  };
}

export function parseZapReceipt(
  event: NostrEvent,
  ownerPubkey: string,
): ParsedZapReceipt | null {
  if (event.kind !== 9735) return null;
  if (!event.tags.some((tag) => tag[0] === 'p' && tag[1] === ownerPubkey)) return null;
  const description = event.tags.find((tag) => tag[0] === 'description')?.[1];
  const bolt11 = event.tags.find((tag) => tag[0] === 'bolt11')?.[1];
  if (!description || !bolt11) return null;

  try {
    const request = JSON.parse(description) as ToolsEvent;
    if (
      !validateEvent(request) ||
      !verifyEvent(request) ||
      request.kind !== 9734 ||
      !request.tags.some((tag) => tag[0] === 'relays' && Boolean(tag[1])) ||
      !request.tags.some((tag) => tag[0] === 'p' && tag[1] === ownerPubkey)
    ) {
      return null;
    }
    const amountSats = satoshisFromBolt11(bolt11);
    if (!Number.isFinite(amountSats) || amountSats <= 0) return null;
    return {
      amountSats,
      senderPubkey: request.pubkey,
      zapRequestId: request.id,
    };
  } catch {
    return null;
  }
}

// Mirrors nostr-tools/nip57 getSatoshisAmountFromBolt11 without importing that
// module's unrelated top-level fetch setup into the authority-constrained artifact.
function satoshisFromBolt11(bolt11: string): number {
  if (bolt11.length < 50) return 0;
  const prefix = bolt11.substring(0, 50);
  const separator = prefix.lastIndexOf('1');
  if (separator === -1) return 0;
  const hrp = prefix.substring(0, separator);
  if (!hrp.startsWith('lnbc')) return 0;
  const amount = hrp.substring(4);
  if (!amount) return 0;
  const suffix = amount.at(-1) ?? '';
  const hasMultiplier = !/^[0-9]$/.test(suffix);
  const numeric = Number.parseInt(hasMultiplier ? amount.slice(0, -1) : amount, 10);
  if (!Number.isFinite(numeric)) return 0;
  if (!hasMultiplier) return numeric * 100_000_000;
  if (suffix === 'm') return numeric * 100_000;
  if (suffix === 'u') return numeric * 100;
  if (suffix === 'n') return numeric / 10;
  if (suffix === 'p') return numeric / 10_000;
  return 0;
}

export class LiveSignalAggregator {
  private readonly windowMs: number;
  private readonly onAggregate: (aggregate: LiveAggregate) => void;
  private signals: PetLiveSignal[] = [];
  private timer: number | null = null;
  private readonly log: (message: string, details?: Record<string, unknown>) => void;

  constructor(options: {
    onAggregate: (aggregate: LiveAggregate) => void;
    windowMs?: number;
    logger?: (message: string, details?: Record<string, unknown>) => void;
  }) {
    this.onAggregate = options.onAggregate;
    this.windowMs = Math.max(0, options.windowMs ?? 700);
    this.log = options.logger ?? ((message, details) => console.log(message, details ?? {}));
    this.log('[nappagochi:live] aggregator created', { windowMs: this.windowMs });
  }

  push(signal: PetLiveSignal): void {
    this.signals.push(signal);
    this.log('[nappagochi:live] signal queued', {
      signalId: signal.id,
      channelId: signal.channelId,
      type: signal.type,
      eventId: signal.eventId,
      queuedSignals: this.signals.length,
    });
    if (this.timer !== null) return;
    this.log('[nappagochi:live] aggregate window started', { windowMs: this.windowMs });
    this.timer = window.setTimeout(() => this.flush(), this.windowMs);
  }

  flush(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    if (!this.signals.length) return;
    const signals = this.signals;
    this.signals = [];
    const byType: Partial<Record<PetLiveSignalType, number>> = {};
    for (const signal of signals) byType[signal.type] = (byType[signal.type] ?? 0) + 1;
    const aggregate: LiveAggregate = {
      windowStartedAt: Math.min(...signals.map((signal) => signal.receivedAt)),
      windowEndedAt: Math.max(...signals.map((signal) => signal.receivedAt)),
      total: signals.length,
      actorCount: new Set(signals.map((signal) => signal.actorPubkey)).size,
      byType,
      // Preserve the zap details needed by downstream reaction and speech policy
      // when a burst also contains later owner activity.
      representativeSignal:
        [...signals].reverse().find((signal) => signal.type === 'zap-received') ??
        signals[signals.length - 1],
    };
    this.log('[nappagochi:live] aggregate emitted', {
      total: aggregate.total,
      actorCount: aggregate.actorCount,
      byType: aggregate.byType,
      windowStartedAt: aggregate.windowStartedAt,
      windowEndedAt: aggregate.windowEndedAt,
    });
    this.onAggregate(aggregate);
  }

  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.signals = [];
    this.log('[nappagochi:live] aggregator destroyed');
  }
}

export function reactionForLiveAggregate(aggregate: LiveAggregate): PetReaction {
  if ((aggregate.byType['zap-received'] ?? 0) > 0) return 'zap-celebrate';
  if ((aggregate.byType['owner-replied'] ?? 0) > 0) return 'reply-roll';
  if ((aggregate.byType['owner-published'] ?? 0) > 0) return 'celebrate';
  return 'notice';
}
