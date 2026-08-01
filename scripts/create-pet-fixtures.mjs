#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  nip19,
  verifyEvent,
} from 'nostr-tools';

const DAY = 86_400;
const BIRTH_D = 'nostr.pet.birth.v1';
const DEFAULT_OUTPUT_DIR = '.pet-test/fixtures';
const DEFAULT_TARGET_URL = 'http://127.0.0.1:5188/';
const MEMORY_RELAY_URLS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
];

export const SCENARIOS = [
  {
    id: 'happy',
    expectedActivity: 'happy',
    expectedDisplay: 'Fragile',
    quietDays: 0,
    description: 'A recent top-level note keeps the activity clock happy.',
  },
  {
    id: 'content',
    expectedActivity: 'content',
    expectedDisplay: 'Fragile',
    quietDays: 4,
    description: 'The latest valid care event is four days old.',
  },
  {
    id: 'lonely',
    expectedActivity: 'lonely',
    expectedDisplay: 'Lonely',
    quietDays: 8,
    description: 'The latest valid care event is eight days old.',
  },
  {
    id: 'sick',
    expectedActivity: 'sick',
    expectedDisplay: 'Sick',
    quietDays: 15,
    description: 'A late top-level note is present but cannot heal sickness.',
  },
  {
    id: 'critical',
    expectedActivity: 'critical',
    expectedDisplay: 'Critical',
    quietDays: 31,
    description: 'A late top-level note is present but cannot heal critical condition.',
  },
  {
    id: 'dead',
    expectedActivity: 'dead',
    expectedDisplay: 'Remembered',
    quietDays: 46,
    description: 'Even a verified reply authored after death cannot revive this birth.',
  },
  {
    id: 'medicine-recovered',
    expectedActivity: 'happy',
    expectedDisplay: 'Fragile',
    quietDays: 0,
    description: 'A verified reply to another author resets a sick pet’s care clock.',
  },
  {
    id: 'successor',
    expectedActivity: 'happy',
    expectedDisplay: 'Fragile',
    quietDays: 0,
    description: 'A new birth references a predecessor that had already crossed death.',
  },
];

function scenarioById(id) {
  const scenario = SCENARIOS.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(
      `Unknown scenario "${id}". Choose one of: ${SCENARIOS.map((item) => item.id).join(', ')}.`,
    );
  }
  return scenario;
}

function sign(secretKey, template) {
  const event = finalizeEvent(template, secretKey);
  if (!verifyEvent(event)) throw new Error('Generated event failed signature verification.');
  return event;
}

function birthTemplate(name, createdAt, previousId) {
  return {
    kind: 78,
    created_at: createdAt,
    tags: [
      ['d', BIRTH_D],
      ['t', 'nostr-pet'],
      ['alt', `Birth event for Nostr Pet ${name}`],
      ...(previousId ? [['e', previousId]] : []),
    ],
    content: JSON.stringify({
      v: 1,
      name,
      species: 'momo',
      appearance: {
        base: 'momo-01',
        palette: 'peach',
        eyes: 'round',
        accessory: 'none',
      },
      ruleset: 'gentle-v1',
    }),
  };
}

function noteTemplate(content, createdAt, tags = []) {
  return {
    kind: 1,
    created_at: createdAt,
    tags,
    content,
  };
}

function createMedicinePair(ownerSecretKey, replyCreatedAt) {
  const doctorSecretKey = generateSecretKey();
  try {
    const doctorPubkey = getPublicKey(doctorSecretKey);
    const parent = sign(
      doctorSecretKey,
      noteTemplate('A local test note from another account.', replyCreatedAt - 60),
    );
    const reply = sign(
      ownerSecretKey,
      noteTemplate('A local verified medicine reply.', replyCreatedAt, [
        ['e', parent.id, '', 'reply'],
        ['p', doctorPubkey],
      ]),
    );
    return { parent, reply };
  } finally {
    doctorSecretKey.fill(0);
  }
}

function createOtherAuthorNote(content, createdAt) {
  const authorSecretKey = generateSecretKey();
  try {
    const event = sign(authorSecretKey, noteTemplate(content, createdAt));
    return {
      event,
      pubkey: getPublicKey(authorSecretKey),
    };
  } finally {
    authorSecretKey.fill(0);
  }
}

function simpleLifecycleEvents(secretKey, scenario, now, name) {
  const birthAt = now - (scenario.quietDays + 1) * DAY;
  const careAt = now - scenario.quietDays * DAY;
  const birth = sign(secretKey, birthTemplate(name, birthAt));
  const care = sign(
    secretKey,
    noteTemplate(`Fixture care event for ${scenario.id}.`, careAt),
  );
  const events = [birth, care];

  if (scenario.id === 'sick' || scenario.id === 'critical') {
    events.push(
      sign(
        secretKey,
        noteTemplate('This late top-level note must not heal the pet.', now - 120),
      ),
    );
  }

  if (scenario.id === 'dead') {
    const medicine = createMedicinePair(secretKey, now - 60);
    events.push(medicine.parent, medicine.reply);
  }

  if (scenario.id === 'happy') {
    const discovery = createOtherAuthorNote(
      'A recent public note for the doctor Discover fallback.',
      now - 300,
    );
    events.push(discovery.event);
  }

  if (scenario.id === 'content') {
    const followed = createOtherAuthorNote(
      'A recent note from a followed account for the doctor.',
      now - 300,
    );
    events.push(
      followed.event,
      sign(secretKey, {
        kind: 3,
        created_at: now - 60,
        tags: [['p', followed.pubkey]],
        content: '',
      }),
    );
  }

  return events;
}

function medicineRecoveredEvents(secretKey, now, name) {
  const birth = sign(secretKey, birthTemplate(name, now - 21 * DAY));
  const earlyCare = sign(
    secretKey,
    noteTemplate('Care before the long quiet period.', now - 20 * DAY),
  );
  const medicine = createMedicinePair(secretKey, now - 60);
  return [birth, earlyCare, medicine.parent, medicine.reply];
}

function successorEvents(secretKey, now, name) {
  const firstBirth = sign(secretKey, birthTemplate(`${name} I`, now - 60 * DAY));
  const successor = sign(
    secretKey,
    birthTemplate(`${name} II`, now - DAY, firstBirth.id),
  );
  const care = sign(secretKey, noteTemplate('The successor is active.', now - 60));
  return [firstBirth, successor, care];
}

export function buildScenario({ id, secretKey, now = Math.floor(Date.now() / 1000) }) {
  const scenario = scenarioById(id);
  const pubkey = getPublicKey(secretKey);
  const displayName = `Momo ${scenario.id
    .split('-')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ')}`;

  let events;
  if (scenario.id === 'medicine-recovered') {
    events = medicineRecoveredEvents(secretKey, now, displayName);
  } else if (scenario.id === 'successor') {
    events = successorEvents(secretKey, now, displayName);
  } else {
    events = simpleLifecycleEvents(secretKey, scenario, now, displayName);
  }

  return {
    scenario,
    pubkey,
    npub: nip19.npubEncode(pubkey),
    events: events.sort(
      (left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id),
    ),
  };
}

export function createPajaConfig(result, targetUrl = DEFAULT_TARGET_URL) {
  return {
    targetUrl,
    simulation: {
      identity: {
        mode: 'fixed',
        pubkey: result.pubkey,
      },
      relay: {
        mode: 'memory',
        urls: MEMORY_RELAY_URLS,
        fixtures: result.events,
      },
      storage: {
        mode: 'memory',
      },
      theme: {
        mode: 'dark',
      },
    },
  };
}

function eventSummary(event) {
  return {
    id: event.id,
    nevent: nip19.neventEncode({
      id: event.id,
      author: event.pubkey,
      kind: event.kind,
    }),
    kind: event.kind,
    pubkey: event.pubkey,
    createdAt: event.created_at,
    createdAtIso: new Date(event.created_at * 1000).toISOString(),
  };
}

async function writeResult(result, options) {
  const filename = `${result.scenario.id}-${result.pubkey.slice(0, 8)}.paja.json`;
  const path = resolve(options.outputDir, filename);
  await writeFile(
    path,
    `${JSON.stringify(createPajaConfig(result, options.targetUrl), null, 2)}\n`,
    { mode: 0o600 },
  );
  return {
    scenario: result.scenario.id,
    description: result.scenario.description,
    expectedActivity: result.scenario.expectedActivity,
    expectedDisplay: result.scenario.expectedDisplay,
    quietDays: result.scenario.quietDays,
    pubkey: result.pubkey,
    npub: result.npub,
    config: path,
    events: result.events.map(eventSummary),
  };
}

async function writeBundle(results, options) {
  await mkdir(options.outputDir, { recursive: true, mode: 0o700 });
  const manifest = [];
  for (const result of results) manifest.push(await writeResult(result, options));
  const manifestPath = resolve(options.outputDir, 'index.json');
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        generatedAt: new Date(options.now * 1000).toISOString(),
        targetUrl: options.targetUrl,
        safety:
          'Local Paja memory fixtures only. No nsec is stored and no public relay receives these events.',
        accounts: manifest,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return { manifest, manifestPath };
}

async function readHiddenNsec() {
  const prompt = 'Paste a TEST-ONLY nsec (input is hidden): ';
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    process.stdout.write(prompt);
    let value = '';
    for await (const chunk of process.stdin) value += chunk;
    process.stdout.write('\n');
    return value.trim();
  }

  process.stdout.write(prompt);
  process.stdin.setEncoding('utf8');
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolveSecret, rejectSecret) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup();
          rejectSecret(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          resolveSecret(value.trim());
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    process.stdin.on('data', onData);
  });
}

export function decodeNsec(value) {
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'nsec' && decoded.data.length === 32) return decoded.data;
  } catch {
    // Keep parser details from echoing any portion of secret input.
  }
  throw new Error('The pasted value is not a valid NIP-19 nsec.');
}

function optionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    mode: '',
    scenario: 'happy',
    outputDir: resolve(DEFAULT_OUTPUT_DIR),
    targetUrl: DEFAULT_TARGET_URL,
    now: Math.floor(Date.now() / 1000),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      continue;
    } else if (argument === '--matrix' || argument === '--paste-nsec' || argument === '--generate') {
      if (options.mode) throw new Error('Choose only one account mode.');
      options.mode = argument.slice(2);
    } else if (argument === '--scenario') {
      options.scenario = optionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--output-dir') {
      options.outputDir = resolve(optionValue(argv, index, argument));
      index += 1;
    } else if (argument === '--target-url') {
      options.targetUrl = new URL(optionValue(argv, index, argument)).href;
      index += 1;
    } else if (argument === '--now') {
      options.now = Number(optionValue(argv, index, argument));
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option "${argument}".`);
    }
  }

  if (!Number.isSafeInteger(options.now) || options.now <= 0) {
    throw new Error('--now must be a positive Unix timestamp.');
  }
  scenarioById(options.scenario);
  return options;
}

function helpText() {
  return `Nappagochi local fixture generator

Usage:
  node scripts/create-pet-fixtures.mjs --matrix
  node scripts/create-pet-fixtures.mjs --generate --scenario <id>
  node scripts/create-pet-fixtures.mjs --paste-nsec --scenario <id>

Options:
  --matrix                 Generate all lifecycle scenarios with ephemeral keys.
  --generate               Generate one scenario with an ephemeral key.
  --paste-nsec             Read one test-only nsec through a hidden prompt.
  --scenario <id>          ${SCENARIOS.map((scenario) => scenario.id).join(', ')}
  --output-dir <path>      Default: ${DEFAULT_OUTPUT_DIR}
  --target-url <url>       Default: ${DEFAULT_TARGET_URL}
  --now <unix-seconds>     Pin fixture time for deterministic tests.

The nsec is used only in this process, zeroed before exit, and never written.
Events are loaded into Paja's memory relay; nothing is sent to public relays.
`;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  if (!options.mode) throw new Error('Choose --matrix, --generate, or --paste-nsec.');

  const results = [];
  if (options.mode === 'matrix') {
    for (const scenario of SCENARIOS) {
      const secretKey = generateSecretKey();
      try {
        results.push(buildScenario({ id: scenario.id, secretKey, now: options.now }));
      } finally {
        secretKey.fill(0);
      }
    }
  } else {
    const secretKey =
      options.mode === 'paste-nsec'
        ? decodeNsec(await readHiddenNsec())
        : generateSecretKey();
    try {
      results.push(buildScenario({ id: options.scenario, secretKey, now: options.now }));
    } finally {
      secretKey.fill(0);
    }
  }

  const output = await writeBundle(results, options);
  process.stdout.write(
    `Created ${output.manifest.length} local account fixture${
      output.manifest.length === 1 ? '' : 's'
    }.\nManifest: ${output.manifestPath}\n\n`,
  );
  for (const account of output.manifest) {
    process.stdout.write(
      `${account.scenario.padEnd(20)} ${account.expectedDisplay.padEnd(11)} ${account.npub}\n` +
        `  PATH="$PATH:$HOME/.deno/bin" kehto paja --config "${account.config}"\n`,
    );
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  run().catch((error) => {
    process.stderr.write(
      `Fixture generation failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
