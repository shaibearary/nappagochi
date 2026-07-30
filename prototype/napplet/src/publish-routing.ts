import type {
  EventTemplate,
  OutboxPublishOptions,
  OutboxPublishResult,
} from '@napplet/sdk';

type Publish = (
  template: EventTemplate,
  options?: OutboxPublishOptions,
) => Promise<OutboxPublishResult>;

function relayListUnavailable(result: OutboxPublishResult): boolean {
  return Boolean(
    !result.ok &&
      result.error?.trim().toLowerCase().includes('relay list unavailable'),
  );
}

export async function publishOutboxFirst(
  publish: Publish,
  template: EventTemplate,
  options: OutboxPublishOptions = {},
  fallbackRelays: string[] = [],
): Promise<OutboxPublishResult> {
  const primaryResult = await publish(template, options);
  if (!relayListUnavailable(primaryResult) || fallbackRelays.length === 0) {
    return primaryResult;
  }

  return publish(template, {
    ...options,
    relays: fallbackRelays,
    toOutbox: false,
  });
}
