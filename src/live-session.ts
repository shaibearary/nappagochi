import type { NostrEvent, NostrFilter, RelayEventResult } from '@napplet/sdk';

export type LiveChannelId = 'owner-activity' | 'owner-habitat' | 'inbound-engagement' | 'follow-activity';

export type LiveChannelDefinition = {
  id: LiveChannelId;
  filters: NostrFilter[];
  authors?: string[];
  relays?: string[];
  limit?: number;
  timeoutMs?: number;
};

export type LiveDelivery = {
  sessionId: string;
  channelId: LiveChannelId;
  event: NostrEvent;
  receivedAt: number;
};

export type LiveChannelStatus = {
  id: LiveChannelId;
  state: 'open' | 'closed';
  reason?: string;
};

export type CloseableLiveChannel = { close(): void };

export type OpenLiveChannel = (
  definition: LiveChannelDefinition,
  onEvent: (result: RelayEventResult) => void,
  onClosed: (reason?: string) => void,
) => CloseableLiveChannel;

type LiveLogger = (message: string, details?: Record<string, unknown>) => void;

export function liveRetryDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= 3) return null;
  return 1_000 * (2 ** attempt);
}

type ActiveChannel = {
  token: symbol;
  handle: CloseableLiveChannel;
};

export class LiveSessionManager {
  readonly id: string;
  readonly mountedAt: number;
  private readonly openChannel: OpenLiveChannel;
  private readonly now: () => number;
  private readonly maxRememberedEventIds: number;
  private readonly log: LiveLogger;
  private channels = new Map<LiveChannelId, ActiveChannel>();
  private rememberedEventIds = new Set<string>();
  private eventIdOrder: string[] = [];
  private deliveryListeners = new Set<(delivery: LiveDelivery) => void>();
  private statusListeners = new Set<(status: LiveChannelStatus) => void>();
  private destroyed = false;

  constructor(options: {
    mountedAt: number;
    openChannel: OpenLiveChannel;
    now?: () => number;
    maxRememberedEventIds?: number;
    sessionId?: string;
    logger?: LiveLogger;
  }) {
    this.mountedAt = options.mountedAt;
    this.openChannel = options.openChannel;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.maxRememberedEventIds = Math.max(1, options.maxRememberedEventIds ?? 2_000);
    this.id = options.sessionId ?? `live-${options.mountedAt}`;
    this.log = options.logger ?? ((message, details) => console.log(message, details ?? {}));
    this.log('[nappagochi:live] session created', {
      sessionId: this.id,
      mountedAt: this.mountedAt,
      maxRememberedEventIds: this.maxRememberedEventIds,
    });
  }

  replaceChannel(definition: LiveChannelDefinition): void {
    if (this.destroyed) {
      this.log('[nappagochi:live] channel open ignored after destroy', { channelId: definition.id });
      return;
    }
    this.closeChannel(definition.id);
    const token = Symbol(definition.id);
    const filters = definition.filters.map((filter) => ({
      ...filter,
      since: Math.max(this.mountedAt, filter.since ?? this.mountedAt),
    }));
    const resolvedDefinition = { ...definition, filters };
    this.log('[nappagochi:live] channel opening', {
      sessionId: this.id,
      channelId: definition.id,
      filters,
      authorCount: definition.authors?.length ?? 0,
      relayHintCount: definition.relays?.length ?? 0,
    });
    this.channels.set(definition.id, { token, handle: { close: () => undefined } });
    try {
      const handle = this.openChannel(
        resolvedDefinition,
        (result) => this.receive(definition.id, token, result),
        (reason) => this.markClosed(definition.id, token, reason),
      );
      const active = this.channels.get(definition.id);
      if (active?.token === token) {
        active.handle = handle;
        this.log('[nappagochi:live] channel open', {
          sessionId: this.id,
          channelId: definition.id,
        });
        this.emitStatus({ id: definition.id, state: 'open' });
      } else {
        handle.close();
      }
    } catch (error) {
      this.channels.delete(definition.id);
      this.emitStatus({
        id: definition.id,
        state: 'closed',
        reason: error instanceof Error ? error.message : 'open-failed',
      });
      this.log('[nappagochi:live] channel open failed', {
        sessionId: this.id,
        channelId: definition.id,
        reason: error instanceof Error ? error.message : 'open-failed',
      });
    }
  }

  closeChannel(id: LiveChannelId): void {
    const active = this.channels.get(id);
    if (!active) return;
    this.channels.delete(id);
    active.handle.close();
    this.log('[nappagochi:live] channel closed locally', {
      sessionId: this.id,
      channelId: id,
    });
    this.emitStatus({ id, state: 'closed', reason: 'replaced-or-closed' });
  }

  onDelivery(listener: (delivery: LiveDelivery) => void): () => void {
    this.deliveryListeners.add(listener);
    return () => this.deliveryListeners.delete(listener);
  }

  onStatus(listener: (status: LiveChannelStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.log('[nappagochi:live] session destroying', {
      sessionId: this.id,
      activeChannelCount: this.channels.size,
      rememberedEventCount: this.rememberedEventIds.size,
    });
    for (const channel of this.channels.values()) channel.handle.close();
    this.channels.clear();
    this.rememberedEventIds.clear();
    this.eventIdOrder = [];
    this.deliveryListeners.clear();
    this.statusListeners.clear();
  }

  private receive(id: LiveChannelId, token: symbol, result: RelayEventResult): void {
    if (this.destroyed || this.channels.get(id)?.token !== token) {
      this.log('[nappagochi:live] delivery ignored from stale channel', {
        sessionId: this.id,
        channelId: id,
        eventId: result.event.id,
      });
      return;
    }
    const event = result.event;
    if (event.created_at < this.mountedAt) {
      this.log('[nappagochi:live] historical delivery ignored', {
        sessionId: this.id,
        channelId: id,
        eventId: event.id,
        eventCreatedAt: event.created_at,
        mountedAt: this.mountedAt,
      });
      return;
    }
    if (this.rememberedEventIds.has(event.id)) {
      this.log('[nappagochi:live] duplicate delivery ignored', {
        sessionId: this.id,
        channelId: id,
        eventId: event.id,
      });
      return;
    }
    this.rememberEventId(event.id);
    const delivery: LiveDelivery = {
      sessionId: this.id,
      channelId: id,
      event,
      receivedAt: this.now(),
    };
    this.log('[nappagochi:live] delivery accepted', {
      sessionId: this.id,
      channelId: id,
      eventId: event.id,
      kind: event.kind,
      actorPubkey: event.pubkey,
      eventCreatedAt: event.created_at,
      receivedAt: delivery.receivedAt,
    });
    for (const listener of this.deliveryListeners) listener(delivery);
  }

  private rememberEventId(eventId: string): void {
    this.rememberedEventIds.add(eventId);
    this.eventIdOrder.push(eventId);
    while (this.eventIdOrder.length > this.maxRememberedEventIds) {
      const oldest = this.eventIdOrder.shift();
      if (oldest) this.rememberedEventIds.delete(oldest);
    }
  }

  private markClosed(id: LiveChannelId, token: symbol, reason?: string): void {
    if (this.channels.get(id)?.token !== token) return;
    this.channels.delete(id);
    this.log('[nappagochi:live] channel closed upstream', {
      sessionId: this.id,
      channelId: id,
      reason: reason ?? 'unspecified',
    });
    this.emitStatus({ id, state: 'closed', reason });
  }

  private emitStatus(status: LiveChannelStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
