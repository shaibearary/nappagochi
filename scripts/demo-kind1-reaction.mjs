#!/usr/bin/env node

import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from 'nostr-tools';
import { buildScenario } from './create-pet-fixtures.mjs';
import {
  publishDemoEvents,
  requireLoopbackRelay,
} from './seed-demo-relay.mjs';

const DEFAULT_RELAY = 'ws://127.0.0.1:7777';

export function buildDemoKind1Event({
  secretKey,
  createdAt = Math.floor(Date.now() / 1000),
  content = 'A local fake Kind 1 note makes Nappagochi jump.',
}) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
    throw new Error('A 32-byte ephemeral test key is required.');
  }
  const event = finalizeEvent({
    kind: 1,
    created_at: createdAt,
    tags: [],
    content,
  }, secretKey);
  if (!verifyEvent(event) || event.pubkey !== getPublicKey(secretKey)) {
    throw new Error('The local Kind 1 test event failed signature verification.');
  }
  return event;
}

function optionValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function parseOptions(argv) {
  const waitMsValue = optionValue(argv, '--wait-ms', '');
  const waitMs = waitMsValue === '' ? null : Number(waitMsValue);
  if (waitMs !== null && (!Number.isSafeInteger(waitMs) || waitMs < 0)) {
    throw new Error('--wait-ms must be a non-negative whole number.');
  }
  return {
    relay: requireLoopbackRelay(optionValue(argv, '--relay', DEFAULT_RELAY)),
    waitMs,
  };
}

function helpText() {
  return `Trigger the Nappagochi Kind 1 jumping reaction on a local relay

Usage:
  pnpm demo:kind1

Options:
  --relay <ws-url>  Default: ${DEFAULT_RELAY}
  --wait-ms <ms>    Publish automatically after a delay instead of waiting for Enter.

The script creates an ephemeral local-only pet, prints its npub, and waits while
you open that npub in View another pet. Press Enter to publish one fresh signed
Kind 1 event. The secret key is kept only in memory and cleared before exit.
`;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function run(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText());
    return;
  }

  const options = parseOptions(argv);
  const secretKey = generateSecretKey();
  try {
    const now = Math.floor(Date.now() / 1000);
    const pet = buildScenario({ id: 'happy', secretKey, now });
    await publishDemoEvents([pet], options.relay);

    process.stdout.write(
      `Local test pet is ready.\n\n` +
      `npub: ${pet.npub}\n` +
      `relay: ${options.relay}\n\n` +
      `In Nappagochi, choose “View another pet” and paste this npub.\n`,
    );

    if (options.waitMs === null) {
      if (!process.stdin.isTTY) {
        throw new Error('Interactive input is unavailable. Use --wait-ms <milliseconds>.');
      }
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      try {
        await prompt.question('When the pet is visible, press Enter to send the fake Kind 1… ');
      } finally {
        prompt.close();
      }
    } else {
      process.stdout.write(`Publishing the fake Kind 1 in ${options.waitMs}ms…\n`);
      await delay(options.waitMs);
    }

    const event = buildDemoKind1Event({ secretKey });
    await publishDemoEvents([{ events: [event] }], options.relay);
    process.stdout.write(
      `Published signed local Kind 1 ${event.id}. The pet should jump now.\n`,
    );
  } finally {
    secretKey.fill(0);
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
