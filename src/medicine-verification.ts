import type { NostrEvent, NostrFilter } from '@napplet/sdk';

export type MedicineVerificationTarget = {
  id: string;
  pubkey: string;
  relay: string;
  replyIds: string[];
};

export type MedicineVerificationBatch = {
  filters: NostrFilter[];
  authors: string[];
  relays: string[];
  targets: MedicineVerificationTarget[];
};

function directReplyTarget(
  event: NostrEvent,
  ownerPubkey: string,
): { id: string; pubkey: string; relay: string } | null {
  const eventTags = event.tags.filter((tag) => tag[0] === 'e' && tag[1]);
  const marked = eventTags.find((tag) => tag[3] === 'reply');
  const target = marked ?? eventTags.at(-1);
  const targetPubkey = event.tags.find(
    (tag) => tag[0] === 'p' && tag[1] && tag[1] !== ownerPubkey,
  )?.[1];
  if (!target?.[1] || !targetPubkey) return null;
  return { id: target[1], pubkey: targetPubkey, relay: target[2] ?? '' };
}

/**
 * Turn as many as forty recent reply checks into one Nostr query envelope.
 * Multiple replies to the same parent share one lookup, which keeps startup
 * bounded even when the local test history grows.
 */
export function buildMedicineVerificationBatch(
  events: NostrEvent[],
  ownerPubkey: string,
  limit = 40,
): MedicineVerificationBatch {
  const candidates = events
    .filter(
      (event) =>
        event.pubkey === ownerPubkey &&
        event.tags.some((tag) => tag[0] === 'e'),
    )
    .sort((left, right) => right.created_at - left.created_at)
    .slice(0, Math.max(0, limit));
  const targetsByParent = new Map<string, MedicineVerificationTarget>();

  for (const event of candidates) {
    const target = directReplyTarget(event, ownerPubkey);
    if (!target) continue;
    const key = `${target.id}:${target.pubkey}`;
    const existing = targetsByParent.get(key);
    if (existing) {
      existing.replyIds.push(event.id);
      if (!existing.relay && target.relay) existing.relay = target.relay;
      continue;
    }
    targetsByParent.set(key, { ...target, replyIds: [event.id] });
  }

  const targets = [...targetsByParent.values()];
  const authors = [...new Set(targets.map((target) => target.pubkey))];
  const relays = [...new Set(targets.map((target) => target.relay).filter(Boolean))];
  return {
    targets,
    authors,
    relays,
    filters: targets.length
      ? [
          {
            ids: [...new Set(targets.map((target) => target.id))],
            authors,
            kinds: [1],
            limit: targets.length,
          },
        ]
      : [],
  };
}

export function verifiedMedicineReplyIds(
  batch: MedicineVerificationBatch,
  parentEvents: NostrEvent[],
  ownerPubkey: string,
): Set<string> {
  const verifiedParents = new Set(
    parentEvents
      .filter(
        (event) =>
          event.kind === 1 &&
          event.pubkey !== ownerPubkey &&
          batch.targets.some(
            (target) => target.id === event.id && target.pubkey === event.pubkey,
          ),
      )
      .map((event) => `${event.id}:${event.pubkey}`),
  );
  const accepted = new Set<string>();
  for (const target of batch.targets) {
    if (!verifiedParents.has(`${target.id}:${target.pubkey}`)) continue;
    for (const replyId of target.replyIds) accepted.add(replyId);
  }
  return accepted;
}
