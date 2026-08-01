import { decode } from 'nostr-tools/nip19';

export function parseViewerNpub(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith('npub1')) {
    throw new Error('Enter a public npub beginning with npub1.');
  }
  try {
    const decoded = decode(normalized);
    if (
      decoded.type === 'npub' &&
      typeof decoded.data === 'string' &&
      /^[0-9a-f]{64}$/.test(decoded.data)
    ) {
      return decoded.data;
    }
  } catch {
    // Return one stable, non-secret-bearing validation message below.
  }
  throw new Error('That npub is not valid. Check it and try again.');
}

export function isReadOnlyView(
  viewedPubkey: string,
  connectedPubkey: string,
): boolean {
  return Boolean(viewedPubkey && viewedPubkey !== connectedPubkey);
}
