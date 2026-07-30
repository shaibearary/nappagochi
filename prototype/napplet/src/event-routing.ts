import type {
  EventTemplate,
  NostrFilter,
  OutboxEventOptions,
  OutboxEventResult,
  OutboxPublishOptions,
  OutboxPublishResult,
  OutboxQueryOptions,
  OutboxRelayPlan,
  OutboxResult,
  RelayEventResult,
} from '@napplet/sdk';
import { publishOutboxFirst } from './publish-routing.ts';

export const DEFAULT_LOCAL_RELAY_URL = 'ws://127.0.0.1:7777';

export type EventRouting = {
  localRelayOnly: boolean;
  localRelayMirror: boolean;
  localRelayUrl: string;
};

type RelayQuery = (filters: NostrFilter | NostrFilter[]) => Promise<RelayEventResult[]>;
type OutboxQuery = (
  filters: NostrFilter[],
  options?: OutboxQueryOptions,
) => Promise<OutboxResult>;
type OutboxGetEvent = (
  eventId: string,
  options?: OutboxEventOptions,
) => Promise<OutboxEventResult>;
type OutboxPublish = (
  template: EventTemplate,
  options?: OutboxPublishOptions,
) => Promise<OutboxPublishResult>;

function loopbackRelayUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const parsed = new URL(value);
    const loopback =
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === 'localhost' ||
      parsed.hostname === '[::1]';
    return loopback && (parsed.protocol === 'ws:' || parsed.protocol === 'wss:')
      ? parsed.origin
      : '';
  } catch {
    return '';
  }
}

function uniqueRelayUrls(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function hybridReadRelayHints(
  routing: EventRouting,
  plan: OutboxRelayPlan | null,
  publicFallbacks: string[],
): string[] {
  if (routing.localRelayOnly) return [routing.localRelayUrl];
  if (!routing.localRelayMirror) return [];
  const hasNip65 =
    plan?.source === 'nip65' &&
    (plan.missingAuthors?.length ?? 0) === 0;
  if (hasNip65) return [routing.localRelayUrl];
  return uniqueRelayUrls([
    routing.localRelayUrl,
    ...(plan?.relays ?? []),
    ...publicFallbacks,
  ]);
}

function withLocalRelayHint<T extends { relays?: string[] }>(
  routing: EventRouting,
  options: T,
): T {
  if (!routing.localRelayMirror) return options;
  return {
    ...options,
    relays: uniqueRelayUrls([...(options.relays ?? []), routing.localRelayUrl]),
  };
}

export function eventRoutingFromConfig(values: Record<string, unknown>): EventRouting {
  const localRelayUrl = loopbackRelayUrl(
    values.nostrPetLocalRelayUrl ?? DEFAULT_LOCAL_RELAY_URL,
  );
  if (!localRelayUrl) {
    return { localRelayOnly: false, localRelayMirror: false, localRelayUrl: '' };
  }
  if (values.nostrPetLocalRelayOnly === true) {
    return {
      localRelayOnly: true,
      localRelayMirror: false,
      localRelayUrl,
    };
  }
  if (values.nostrPetLocalRelayMirror === false) {
    return { localRelayOnly: false, localRelayMirror: false, localRelayUrl: '' };
  }
  return {
    localRelayOnly: false,
    localRelayMirror: true,
    localRelayUrl,
  };
}

export async function queryEventsWithRouting(
  routing: EventRouting,
  relayQuery: RelayQuery,
  outboxQuery: OutboxQuery,
  filters: NostrFilter[],
  options?: OutboxQueryOptions,
): Promise<OutboxResult> {
  if (routing.localRelayOnly) {
    return { events: await relayQuery(filters) };
  }
  return outboxQuery(
    filters,
    withLocalRelayHint(routing, options ?? {}),
  );
}

export async function getEventWithRouting(
  routing: EventRouting,
  relayQuery: RelayQuery,
  outboxGetEvent: OutboxGetEvent,
  eventId: string,
  options?: OutboxEventOptions,
): Promise<OutboxEventResult> {
  if (!routing.localRelayOnly) {
    return outboxGetEvent(
      eventId,
      withLocalRelayHint(routing, options ?? {}),
    );
  }
  const events = await relayQuery([
    {
      ids: [eventId],
      ...(options?.author ? { authors: [options.author] } : {}),
      limit: 1,
    },
  ]);
  const result = events.find((candidate) => candidate.event.id === eventId);
  return result ? { result } : { error: 'not found' };
}

export async function publishEventWithRouting(
  routing: EventRouting,
  outboxPublish: OutboxPublish,
  template: EventTemplate,
  options: OutboxPublishOptions = {},
  fallbackRelays: string[] = [],
  hasNip65?: boolean,
): Promise<OutboxPublishResult> {
  if (routing.localRelayOnly) {
    return outboxPublish(template, {
      relays: [routing.localRelayUrl],
      toOutbox: false,
    });
  }
  const primaryOptions = routing.localRelayMirror
    ? {
        ...options,
        relays: uniqueRelayUrls([
          routing.localRelayUrl,
          ...(options.relays ?? []),
        ]),
      }
    : options;
  const explicitFallbacks = routing.localRelayMirror
    ? uniqueRelayUrls([routing.localRelayUrl, ...fallbackRelays])
    : fallbackRelays;
  if (routing.localRelayMirror && hasNip65 === false) {
    const { toInboxes: _unresolvedInboxes, ...fallbackOptions } = options;
    return outboxPublish(template, {
      ...fallbackOptions,
      relays: explicitFallbacks,
      toOutbox: false,
    });
  }
  return publishOutboxFirst(
    outboxPublish,
    template,
    primaryOptions,
    explicitFallbacks,
  );
}
