import type { NostrEvent, OutboxPublishResult } from '@napplet/sdk';

export type ActivityState =
  | 'happy'
  | 'content'
  | 'lonely'
  | 'sick'
  | 'critical'
  | 'dead';

export type ActivityHealth = {
  state: ActivityState;
  lastCareAt: number;
  daysQuiet: number;
  canFeed: boolean;
};

type ReduceActivityInput = {
  birthCreatedAt: number;
  ownerPubkey: string;
  notes: NostrEvent[];
  verifiedMedicineIds: Set<string>;
  at: number;
  daySeconds?: number;
};

type AcceptedPublish = {
  ownerPubkey: string;
  kind: number;
};

function hasReplyTag(event: NostrEvent): boolean {
  return event.tags.some((tag) => tag[0] === 'e');
}

export function activityStateForElapsed(
  seconds: number,
  daySeconds = 86_400,
): ActivityState {
  if (seconds < 3 * daySeconds) return 'happy';
  if (seconds < 7 * daySeconds) return 'content';
  if (seconds < 14 * daySeconds) return 'lonely';
  if (seconds < 30 * daySeconds) return 'sick';
  if (seconds < 45 * daySeconds) return 'critical';
  return 'dead';
}

export function reduceActivityHealth(input: ReduceActivityInput): ActivityHealth {
  const daySeconds = input.daySeconds ?? 86_400;
  let lastCareAt = input.birthCreatedAt;
  const activity = input.notes
    .filter(
      (event) =>
        event.pubkey === input.ownerPubkey &&
        event.created_at >= input.birthCreatedAt &&
        event.created_at <= input.at,
    )
    .sort((left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id));

  for (const event of activity) {
    const stateBefore = activityStateForElapsed(
      Math.max(0, event.created_at - lastCareAt),
      daySeconds,
    );
    if (stateBefore === 'dead') break;
    if (input.verifiedMedicineIds.has(event.id)) {
      lastCareAt = event.created_at;
    } else if (!hasReplyTag(event) && stateBefore !== 'sick' && stateBefore !== 'critical') {
      lastCareAt = event.created_at;
    }
  }

  const quietSeconds = Math.max(0, input.at - lastCareAt);
  const state = activityStateForElapsed(quietSeconds, daySeconds);
  return {
    state,
    lastCareAt,
    daysQuiet: Math.floor(quietSeconds / daySeconds),
    canFeed: state === 'happy' || state === 'content' || state === 'lonely',
  };
}

export function requireAcceptedPublishedEvent(
  result: OutboxPublishResult,
  expected: AcceptedPublish,
): NostrEvent {
  if (!result.ok) {
    throw new Error(result.error?.trim() || 'No relay accepted the event.');
  }
  const event = result.event;
  if (!event) {
    throw new Error('The signer did not return a signed event.');
  }
  if (event.pubkey !== expected.ownerPubkey) {
    throw new Error('The signer returned an event for a different account.');
  }
  if (event.kind !== expected.kind) {
    throw new Error('The signer returned a different event kind.');
  }
  if (
    !/^[0-9a-f]{64}$/i.test(event.id) ||
    !/^[0-9a-f]{128}$/i.test(event.sig) ||
    (result.eventId && result.eventId !== event.id)
  ) {
    throw new Error('The signer returned an invalid signed event.');
  }
  return event;
}

export function mergeEventHistory(
  current: NostrEvent[],
  incoming: NostrEvent[],
): NostrEvent[] {
  const eventsById = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) eventsById.set(event.id, event);
  return [...eventsById.values()].sort(
    (left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id),
  );
}

export function acceptedRelayCount(result: OutboxPublishResult): number {
  return Object.values(result.relays ?? {}).filter(Boolean).length;
}
