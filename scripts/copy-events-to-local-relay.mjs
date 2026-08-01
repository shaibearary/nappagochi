#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyEvent } from 'nostr-tools';

const DEFAULT_SOURCES = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
];
const DEFAULT_DESTINATION = 'ws://127.0.0.1:7777';

function optionValues(argv, name) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    values.push(value);
    index += 1;
  }
  return values;
}

function optionValue(argv, name, fallback = '') {
  return optionValues(argv, name).at(-1) ?? fallback;
}

export function parseCopyOptions(argv) {
  const eventIds = optionValues(argv, '--event');
  const author = optionValue(argv, '--author');
  const kindValue = optionValue(argv, '--kind');
  const dTag = optionValue(argv, '--d');
  const sources = optionValues(argv, '--source');
  const destination = optionValue(argv, '--destination', DEFAULT_DESTINATION);

  if (!eventIds.length && !author) {
    throw new Error('Provide at least one --event id or one --author pubkey');
  }
  for (const id of eventIds) {
    if (!/^[0-9a-f]{64}$/i.test(id)) throw new Error(`Invalid event id: ${id}`);
  }
  if (author && !/^[0-9a-f]{64}$/i.test(author)) {
    throw new Error('Invalid --author pubkey');
  }
  const kind = kindValue ? Number(kindValue) : undefined;
  if (kind !== undefined && !Number.isSafeInteger(kind)) {
    throw new Error('--kind must be an integer');
  }

  const filter = {
    ...(eventIds.length ? { ids: eventIds.map((id) => id.toLowerCase()) } : {}),
    ...(author ? { authors: [author.toLowerCase()] } : {}),
    ...(kind !== undefined ? { kinds: [kind] } : {}),
    ...(dTag ? { '#d': [dTag] } : {}),
    limit: Math.max(20, eventIds.length),
  };
  return {
    filter,
    sources: sources.length ? sources : DEFAULT_SOURCES,
    destination,
  };
}

function queryRelay(relayUrl, filter, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(relayUrl);
    const subscriptionId = `copy-${crypto.randomUUID()}`;
    const events = [];
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // The connection may already be closed after a relay/network failure.
      }
      if (error) reject(error);
      else resolve(events);
    };
    const timeout = setTimeout(
      () => finish(new Error(`query timed out: ${relayUrl}`)),
      timeoutMs,
    );

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(['REQ', subscriptionId, filter]));
    });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message[0] === 'EVENT' && message[1] === subscriptionId) {
        events.push(message[2]);
      }
      if (message[0] === 'EOSE' && message[1] === subscriptionId) {
        socket.send(JSON.stringify(['CLOSE', subscriptionId]));
        finish();
      }
    });
    socket.addEventListener('error', () => {
      finish(new Error(`connection failed: ${relayUrl}`));
    });
  });
}

function publishEvent(relayUrl, event, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(relayUrl);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // The connection may already be closed.
      }
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(
      () => finish(new Error(`publish timed out: ${relayUrl}`)),
      timeoutMs,
    );

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(['EVENT', event]));
    });
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data));
      if (message[0] !== 'OK' || message[1] !== event.id) return;
      if (message[2] === true) finish();
      else finish(new Error(String(message[3] || 'destination rejected event')));
    });
    socket.addEventListener('error', () => {
      finish(new Error(`connection failed: ${relayUrl}`));
    });
  });
}

export async function copyEvents(options) {
  const results = await Promise.allSettled(
    options.sources.map((source) => queryRelay(source, options.filter)),
  );
  const eventsById = new Map();
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const event of result.value) {
      if (verifyEvent(event)) eventsById.set(event.id, event);
    }
  }
  if (!eventsById.size) {
    const failures = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(
      failures.length
        ? `No matching signed events found. ${failures.join('; ')}`
        : 'No matching signed events found.',
    );
  }

  for (const event of eventsById.values()) {
    await publishEvent(options.destination, event);
  }
  return [...eventsById.values()];
}

function helpText() {
  return `Copy already-signed Nostr events into the local test relay

Usage:
  node scripts/copy-events-to-local-relay.mjs --event <hex-event-id>
  node scripts/copy-events-to-local-relay.mjs --author <hex-pubkey> --kind 78 --d nostr.pet.birth.v1

Options:
  --event <id>           Exact event id; repeatable.
  --author <pubkey>      Restrict to one author.
  --kind <number>        Optional event kind.
  --d <value>            Optional d-tag.
  --source <wss-url>     Source relay; repeatable.
  --destination <ws-url> Default: ${DEFAULT_DESTINATION}

This command copies valid signed public events. It never requests a private key.
`;
}

export async function run(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText());
    return;
  }
  const options = parseCopyOptions(argv);
  const events = await copyEvents(options);
  process.stdout.write(
    `Copied ${events.length} signed event${events.length === 1 ? '' : 's'} to ${options.destination}:\n`,
  );
  for (const event of events) {
    process.stdout.write(`  ${event.id} kind ${event.kind} author ${event.pubkey}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
