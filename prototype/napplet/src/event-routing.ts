import type {
  EventTemplate,
  NostrFilter,
  OutboxEventOptions,
  OutboxEventResult,
  OutboxPublishOptions,
  OutboxPublishResult,
  OutboxQueryOptions,
  OutboxResult,
  RelayEventResult,
} from '@napplet/sdk';
import { publishOutboxFirst } from './publish-routing.ts';

export const DEFAULT_LOCAL_RELAY_URL = 'ws://127.0.0.1:7777';

export type EventRouting = {
  localRelayOnly: boolean;
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

export function eventRoutingFromConfig(values: Record<string, unknown>): EventRouting {
  if (values.nostrPetLocalRelayOnly !== true) {
    return { localRelayOnly: false, localRelayUrl: '' };
  }
  const localRelayUrl = loopbackRelayUrl(
    values.nostrPetLocalRelayUrl ?? DEFAULT_LOCAL_RELAY_URL,
  );
  return {
    localRelayOnly: Boolean(localRelayUrl),
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
  return outboxQuery(filters, options);
}

export async function getEventWithRouting(
  routing: EventRouting,
  relayQuery: RelayQuery,
  outboxGetEvent: OutboxGetEvent,
  eventId: string,
  options?: OutboxEventOptions,
): Promise<OutboxEventResult> {
  if (!routing.localRelayOnly) return outboxGetEvent(eventId, options);
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
): Promise<OutboxPublishResult> {
  if (routing.localRelayOnly) {
    return outboxPublish(template, {
      relays: [routing.localRelayUrl],
      toOutbox: false,
    });
  }
  return publishOutboxFirst(outboxPublish, template, options, fallbackRelays);
}
