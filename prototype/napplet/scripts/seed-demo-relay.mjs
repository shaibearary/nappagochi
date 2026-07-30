#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateSecretKey, verifyEvent } from 'nostr-tools';
import { SCENARIOS, buildScenario } from './create-pet-fixtures.mjs';

const DEFAULT_RELAY = 'ws://127.0.0.1:7777';
const DEFAULT_MANIFEST = '.pet-test/demo-relay/index.json';

export function requireLoopbackRelay(value) {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === '127.0.0.1' ||
      url.hostname === 'localhost' ||
      url.hostname === '[::1]';
    if (url.protocol !== 'ws:' || !loopback) throw new Error();
    return url.origin;
  } catch {
    throw new Error('Demo fixtures may be seeded only to a local ws:// loopback relay.');
  }
}

export function buildDemoMatrix({
  now = Math.floor(Date.now() / 1000),
  secretKeys,
} = {}) {
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error('Demo time must be a positive Unix timestamp.');
  }
  if (secretKeys && secretKeys.length !== SCENARIOS.length) {
    throw new Error(`Expected ${SCENARIOS.length} test keys.`);
  }

  const results = [];
  for (let index = 0; index < SCENARIOS.length; index += 1) {
    const generated = !secretKeys;
    const secretKey = secretKeys?.[index] ?? generateSecretKey();
    try {
      results.push(
        buildScenario({
          id: SCENARIOS[index].id,
          secretKey,
          now,
        }),
      );
    } finally {
      if (generated) secretKey.fill(0);
    }
  }
  return results;
}

export function buildDemoManifest(results, {
  relay = DEFAULT_RELAY,
  now = Math.floor(Date.now() / 1000),
} = {}) {
  return {
    generatedAt: new Date(now * 1000).toISOString(),
    relay: requireLoopbackRelay(relay),
    safety:
      'Signed local demo events only. No private keys are stored and no public relay receives these fixtures.',
    accounts: results.map((result) => ({
      scenario: result.scenario.id,
      activityState: result.scenario.expectedActivity,
      expectedDisplay: result.scenario.expectedDisplay,
      description: result.scenario.description,
      npub: result.npub,
      pubkey: result.pubkey,
      eventCount: result.events.length,
      birthEventId:
        result.events.find(
          (event) =>
            event.kind === 78 &&
            event.tags.some(
              (tag) => tag[0] === 'd' && tag[1] === 'nostr.pet.birth.v1',
            ),
        )?.id ?? '',
    })),
  };
}

function openRelay(relayUrl, timeoutMs) {
  return new Promise((resolveOpen, rejectOpen) => {
    const socket = new WebSocket(relayUrl);
    const timeout = setTimeout(() => {
      socket.close();
      rejectOpen(new Error(`Timed out connecting to ${relayUrl}.`));
    }, timeoutMs);
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolveOpen(socket);
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        rejectOpen(new Error(`Could not connect to ${relayUrl}. Is pnpm relay:local running?`));
      },
      { once: true },
    );
  });
}

function publishOne(socket, event, timeoutMs) {
  return new Promise((resolvePublish, rejectPublish) => {
    const finish = (error) => {
      clearTimeout(timeout);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
      if (error) rejectPublish(error);
      else resolvePublish();
    };
    const onMessage = ({ data }) => {
      const message = JSON.parse(String(data));
      if (message[0] !== 'OK' || message[1] !== event.id) return;
      if (message[2] === true) finish();
      else finish(new Error(String(message[3] || `Relay rejected ${event.id}.`)));
    };
    const onError = () => finish(new Error(`Relay connection failed while publishing ${event.id}.`));
    const timeout = setTimeout(
      () => finish(new Error(`Timed out publishing ${event.id}.`)),
      timeoutMs,
    );
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.send(JSON.stringify(['EVENT', event]));
  });
}

export async function publishDemoEvents(
  results,
  relay = DEFAULT_RELAY,
  timeoutMs = 5_000,
) {
  const relayUrl = requireLoopbackRelay(relay);
  const events = results.flatMap((result) => result.events);
  if (!events.length || events.some((event) => !verifyEvent(event))) {
    throw new Error('Refusing to seed an empty or invalid event matrix.');
  }

  const socket = await openRelay(relayUrl, timeoutMs);
  try {
    for (const event of events) await publishOne(socket, event, timeoutMs);
  } finally {
    socket.close();
  }
  return { relay: relayUrl, eventCount: events.length };
}

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function parseOptions(argv) {
  const now = Number(optionValue(argv, '--now', Math.floor(Date.now() / 1000)));
  if (!Number.isSafeInteger(now) || now <= 0) {
    throw new Error('--now must be a positive Unix timestamp.');
  }
  return {
    relay: requireLoopbackRelay(optionValue(argv, '--relay', DEFAULT_RELAY)),
    manifestPath: resolve(optionValue(argv, '--manifest', DEFAULT_MANIFEST)),
    now,
  };
}

function helpText() {
  return `Seed the persistent local relay with a Nostr Pet demo matrix

Usage:
  node scripts/seed-demo-relay.mjs

Options:
  --relay <ws-url>       Default: ${DEFAULT_RELAY}
  --manifest <path>      Default: ${DEFAULT_MANIFEST}
  --now <unix-seconds>   Pin fixture time.

The destination must be a loopback relay. Fresh ephemeral keys sign the events,
then are discarded. Existing relay events are preserved.
`;
}

export async function run(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText());
    return;
  }
  const options = parseOptions(argv);
  const results = buildDemoMatrix({ now: options.now });
  const published = await publishDemoEvents(results, options.relay);
  const manifest = buildDemoManifest(results, options);
  await mkdir(dirname(options.manifestPath), { recursive: true, mode: 0o700 });
  await writeFile(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o600,
  });

  process.stdout.write(
    `Seeded ${published.eventCount} signed events for ${manifest.accounts.length} demo pets.\n` +
      `Relay: ${published.relay}\nManifest: ${options.manifestPath}\n\n`,
  );
  for (const account of manifest.accounts) {
    process.stdout.write(
      `${account.scenario.padEnd(20)} ${account.activityState.padEnd(10)} ${account.expectedDisplay.padEnd(11)} ${account.npub}\n`,
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
