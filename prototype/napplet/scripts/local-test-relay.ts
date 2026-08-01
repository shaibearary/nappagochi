#!/usr/bin/env -S deno run

import { dirname, resolve } from 'node:path';
import { verifyEvent } from 'npm:nostr-tools@2.23.5';

type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

type Filter = {
  ids?: string[];
  authors?: string[];
  kinds?: number[];
  since?: number;
  until?: number;
  limit?: number;
  [key: `#${string}`]: unknown;
};

type Subscription = {
  id: string;
  filters: Filter[];
};

function optionValue(name: string, fallback: string): string {
  const index = Deno.args.indexOf(name);
  if (index === -1) return fallback;
  const value = Deno.args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`, 'i').test(value);
}

function isNostrEvent(value: unknown): value is NostrEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Partial<NostrEvent>;
  return (
    isHex(event.id, 64) &&
    isHex(event.pubkey, 64) &&
    Number.isSafeInteger(event.created_at) &&
    Number.isSafeInteger(event.kind) &&
    Array.isArray(event.tags) &&
    event.tags.every(
      (tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string'),
    ) &&
    typeof event.content === 'string' &&
    isHex(event.sig, 128)
  );
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value
    : null;
}

function numberList(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item))
    ? value
    : null;
}

function isFilter(value: unknown): value is Filter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const filter = value as Filter;
  if (filter.ids !== undefined && !stringList(filter.ids)) return false;
  if (filter.authors !== undefined && !stringList(filter.authors)) return false;
  if (filter.kinds !== undefined && !numberList(filter.kinds)) return false;
  if (filter.since !== undefined && !Number.isSafeInteger(filter.since)) return false;
  if (filter.until !== undefined && !Number.isSafeInteger(filter.until)) return false;
  if (
    filter.limit !== undefined &&
    (!Number.isSafeInteger(filter.limit) || filter.limit < 0)
  ) {
    return false;
  }
  return Object.entries(filter).every(
    ([key, item]) => !key.startsWith('#') || stringList(item) !== null,
  );
}

function matchesFilter(event: NostrEvent, filter: Filter): boolean {
  if (filter.ids && !filter.ids.some((prefix) => event.id.startsWith(prefix))) return false;
  if (
    filter.authors &&
    !filter.authors.some((prefix) => event.pubkey.startsWith(prefix))
  ) {
    return false;
  }
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;

  for (const [key, rawValues] of Object.entries(filter)) {
    if (!key.startsWith('#')) continue;
    const values = stringList(rawValues);
    if (!values) return false;
    const tagName = key.slice(1);
    if (!event.tags.some((tag) => tag[0] === tagName && values.includes(tag[1]))) {
      return false;
    }
  }
  return true;
}

function queryEvents(events: Iterable<NostrEvent>, filters: Filter[]): NostrEvent[] {
  const result = new Map<string, NostrEvent>();
  const sorted = [...events].sort(
    (left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id),
  );
  for (const filter of filters.length ? filters : [{}]) {
    const matches = sorted.filter((event) => matchesFilter(event, filter));
    const limited =
      filter.limit === undefined ? matches : matches.slice(0, Math.max(0, filter.limit));
    for (const event of limited) result.set(event.id, event);
  }
  return [...result.values()].sort(
    (left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id),
  );
}

function send(socket: WebSocket, message: unknown[]): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

const portValue = Number(optionValue('--port', '7777'));
if (!Number.isSafeInteger(portValue) || portValue < 1 || portValue > 65_535) {
  throw new Error('--port must be an integer from 1 to 65535');
}

const dataPath = resolve(optionValue('--data', '.pet-test/local-relay/events.json'));
await Deno.mkdir(dirname(dataPath), { recursive: true });

const events = new Map<string, NostrEvent>();
try {
  const stored = JSON.parse(await Deno.readTextFile(dataPath)) as unknown;
  if (!Array.isArray(stored)) throw new Error('the event store is not an array');
  for (const event of stored) {
    if (!isNostrEvent(event) || !verifyEvent(event)) {
      throw new Error('the event store contains an invalid signed event');
    }
    events.set(event.id, event);
  }
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
}

let persistQueue = Promise.resolve();
function persist(): Promise<void> {
  const snapshot = `${JSON.stringify([...events.values()], null, 2)}\n`;
  const temporaryPath = `${dataPath}.tmp`;
  persistQueue = persistQueue.then(async () => {
    await Deno.writeTextFile(temporaryPath, snapshot, { mode: 0o600 });
    await Deno.rename(temporaryPath, dataPath);
  });
  return persistQueue;
}

const sockets = new Map<WebSocket, Map<string, Subscription>>();

function broadcast(event: NostrEvent): void {
  for (const [socket, subscriptions] of sockets) {
    for (const subscription of subscriptions.values()) {
      if (subscription.filters.some((filter) => matchesFilter(event, filter))) {
        send(socket, ['EVENT', subscription.id, event]);
      }
    }
  }
}

async function handleMessage(socket: WebSocket, raw: string): Promise<void> {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    send(socket, ['NOTICE', 'invalid: message is not JSON']);
    return;
  }
  if (!Array.isArray(message) || typeof message[0] !== 'string') {
    send(socket, ['NOTICE', 'invalid: expected a NIP-01 array']);
    return;
  }

  const type = message[0];
  if (type === 'EVENT') {
    const event = message[1];
    const eventId =
      typeof event === 'object' &&
      event !== null &&
      'id' in event &&
      typeof event.id === 'string'
        ? event.id
        : '';
    if (!isNostrEvent(event) || !verifyEvent(event)) {
      send(socket, ['OK', eventId, false, 'invalid: event signature or shape']);
      return;
    }
    if (events.has(event.id)) {
      send(socket, ['OK', event.id, true, 'duplicate: already stored']);
      return;
    }
    events.set(event.id, event);
    try {
      await persist();
    } catch (error) {
      events.delete(event.id);
      send(socket, [
        'OK',
        event.id,
        false,
        `error: persistence failed (${error instanceof Error ? error.message : 'unknown'})`,
      ]);
      return;
    }
    broadcast(event);
    send(socket, ['OK', event.id, true, '']);
    console.log(`EVENT ${event.id} kind=${event.kind} pubkey=${event.pubkey}`);
    return;
  }

  if (type === 'REQ') {
    const subscriptionId = message[1];
    const filters = message.slice(2);
    if (
      typeof subscriptionId !== 'string' ||
      subscriptionId.length === 0 ||
      !filters.every(isFilter)
    ) {
      send(socket, ['NOTICE', 'invalid: malformed REQ']);
      return;
    }
    const subscriptions = sockets.get(socket);
    subscriptions?.set(subscriptionId, {
      id: subscriptionId,
      filters: filters as Filter[],
    });
    for (const event of queryEvents(events.values(), filters as Filter[])) {
      send(socket, ['EVENT', subscriptionId, event]);
    }
    send(socket, ['EOSE', subscriptionId]);
    return;
  }

  if (type === 'CLOSE') {
    if (typeof message[1] === 'string') sockets.get(socket)?.delete(message[1]);
    return;
  }

  if (type === 'COUNT') {
    const subscriptionId = message[1];
    const filters = message.slice(2);
    if (
      typeof subscriptionId !== 'string' ||
      subscriptionId.length === 0 ||
      !filters.every(isFilter)
    ) {
      send(socket, ['NOTICE', 'invalid: malformed COUNT']);
      return;
    }
    send(socket, [
      'COUNT',
      subscriptionId,
      { count: queryEvents(events.values(), filters as Filter[]).length },
    ]);
    return;
  }

  send(socket, ['NOTICE', `unsupported: ${type}`]);
}

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  Deno.addSignalListener(signal, () => controller.abort());
}

const server = Deno.serve(
  {
    hostname: '127.0.0.1',
    port: portValue,
    signal: controller.signal,
    onListen: ({ hostname, port }) => {
      console.log(`READY ws://${hostname}:${port} events=${events.size} data=${dataPath}`);
    },
  },
  (request) => {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const { socket, response } = Deno.upgradeWebSocket(request);
      socket.onopen = () => sockets.set(socket, new Map());
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') void handleMessage(socket, event.data);
      };
      socket.onclose = () => sockets.delete(socket);
      socket.onerror = () => sockets.delete(socket);
      return response;
    }

    return new Response(
      JSON.stringify({
        name: 'Nappagochi Local Test Relay',
        description: 'Loopback-only persistent relay for napplet development.',
        supported_nips: [1, 11, 45],
        software: 'nappagochi-local-test-relay',
        version: '1',
      }),
      {
        headers: {
          'content-type': request.headers
              .get('accept')
              ?.includes('application/nostr+json')
            ? 'application/nostr+json'
            : 'application/json',
        },
      },
    );
  },
);

await server.finished;
await persistQueue;
