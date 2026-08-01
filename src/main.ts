import {
  common,
  config,
  identity,
  link,
  outbox,
  relay,
  resource,
  storage,
  themeGet,
  themeOnChanged,
  type EventTemplate,
  type CommonProfileData,
  type NostrEvent,
  type NostrFilter,
  type OutboxEventOptions,
  type OutboxPublishOptions,
  type OutboxPublishResult,
  type OutboxQueryOptions,
  type OutboxRelayPlan,
  type OutboxResult,
  type ProfileData,
  type RelayEventResult,
  type Subscription,
  type Theme,
} from '@napplet/sdk';
import { npubEncode } from 'nostr-tools/nip19';
import {
  acceptedRelayCount,
  mergeEventHistory,
  reduceActivityHealth,
  requireAcceptedPublishedEvent,
  type ActivityState,
} from './activity-reconciliation';
import {
  eventRoutingFromConfig,
  getEventWithRouting,
  hybridReadRelayHints,
  publishEventWithRouting,
  queryEventsWithRouting,
  type EventRouting,
} from './event-routing';
import {
  HABITAT_SICK_AFTER_DAYS,
  applyHabitatSickness,
  reduceHabitatSickness,
} from './habitat-sickness';
import { isReadOnlyView, parseViewerNpub } from './view-mode';
import {
  PetEmotionController,
  petPoseStyle,
  resolvePetPose,
  type PetEmotionSnapshot,
} from './pet-emotion';
import {
  LiveSessionManager,
  liveRetryDelay,
  type LiveChannelDefinition,
  type LiveChannelId,
  type LiveDelivery,
  type OpenLiveChannel,
} from './live-session';
import {
  classifyOwnerActivityDelivery,
  classifyInboundDelivery,
  LiveSignalAggregator,
  reactionForLiveAggregate,
} from './live-aggregation';
import {
  PetSpeechController,
  speechForLiveAggregate,
  type PetSpeechSnapshot,
} from './pet-speech';
import { ReactionMetadataLoader } from './reaction-enrichment';
import { scoreProfileChecks, type ProfileTier } from './profile-scoring';
import './styles.css';

declare global {
  interface Window {
    napplet?: {
      identity?: {
        getPublicKey?: unknown;
        getProfile?: unknown;
        getFollows?: unknown;
        getRelays?: unknown;
        onChanged?: unknown;
      };
      outbox?: {
        getEvent?: unknown;
        query?: unknown;
        subscribe?: unknown;
        publish?: unknown;
      };
    };
  }
}

const BIRTH_D = 'nostr.pet.birth.v1';
const PROFILE_D_PREFIX = 'nostr.pet.profile.v1:';
const DAY = 86_400;
const DOCTOR_DISCOVERY_LOOKBACK = 7 * DAY;
const FUTURE_TOLERANCE = 600;
const PROFILE_HEALTH_MAX = 8;
const GIGI_PROFILE_HEALTH_URL =
  'https://github.com/dergigi/napplet-workshop/tree/master/profile-health';
const HABITAT_EVENT_KINDS = new Set([
  0,
  3,
  10_002,
  10_019,
  10_050,
  17_375,
  37_375,
]);
const PROFILE_FIELDS: Array<keyof ProfileData> = [
  'name',
  'displayName',
  'about',
  'picture',
  'banner',
];
const BLOSSOM_HOSTS = new Set([
  'blossom.primal.net',
  'cdn.satellite.earth',
  'files.v0l.io',
  'blossom.oxtr.dev',
  'blossom.band',
  'media.nostr.build',
]);
const DEFAULT_PUBLISH_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
];
const APP_MOUNTED_AT = Math.floor(Date.now() / 1000);

type PetState = ActivityState;
type Palette = 'peach' | 'mint' | 'night';
type Eyes = 'round' | 'sleepy' | 'sparkle';
type Accessory = 'none' | 'bow' | 'hat';
type Modal =
  | 'note'
  | 'doctor'
  | 'settings'
  | 'preview'
  | 'profile'
  | 'habitat-source'
  | 'viewer'
  | null;
type ProfileCheckStatus = 'pass' | 'warn' | 'fail' | 'unavailable';
type RelayPermissions = Record<string, { read: boolean; write: boolean }>;

type Appearance = {
  base: 'momo-01';
  palette: Palette;
  eyes: Eyes;
  accessory: Accessory;
};

type PetData = {
  v: 1;
  name: string;
  species: 'momo';
  appearance: Appearance;
  ruleset: 'gentle-v1';
};

type Birth = {
  event: NostrEvent;
  data: PetData;
  previousId?: string;
};

type Health = {
  state: PetState;
  activityState: PetState;
  lastCareAt: number;
  daysQuiet: number;
  canFeed: boolean;
  habitatSick: boolean;
  habitatDaysIncomplete: number;
};

type DoctorCandidate = {
  event: NostrEvent;
  relayHint: string;
};
type DoctorSource = 'follows' | 'discovery' | null;
type RelayPlanSource = 'pending' | 'local-only' | 'nip65' | 'fallback' | 'normal';

type ProfileCheck = {
  label: string;
  status: ProfileCheckStatus;
  detail: string;
  point: boolean;
  assessed?: boolean;
};

type ProfileHealth = {
  score: number;
  max: number;
  tier: ProfileTier;
  checks: ProfileCheck[];
};

const DEFAULT_APPEARANCE: Appearance = {
  base: 'momo-01',
  palette: 'peach',
  eyes: 'round',
  accessory: 'none',
};

const FALLBACK_THEME: Theme = {
  colors: {
    background: '#fff7e9',
    text: '#30241f',
    primary: '#ef6b55',
  },
  title: 'Warm paper',
};

const STATE_META: Record<
  PetState,
  { label: string; face: string; note: string; next: string }
> = {
  happy: {
    label: 'Thriving',
    face: '＾',
    note: 'Bright-eyed and delighted to see you.',
    next: 'Content after 3 quiet days',
  },
  content: {
    label: 'Content',
    face: '•',
    note: 'Cozy, calm, and still feeling connected.',
    next: 'Lonely after 7 quiet days',
  },
  lonely: {
    label: 'Lonely',
    face: '﹏',
    note: 'Missing your voice on Nostr.',
    next: 'Sick after 14 quiet days',
  },
  sick: {
    label: 'Sick',
    face: '×',
    note: 'A normal post is no longer enough. Save your pet with medicine.',
    next: 'Critical after 30 quiet days',
  },
  critical: {
    label: 'Critical',
    face: '—',
    note: 'Time matters. A thoughtful message can still save your pet.',
    next: 'Dies after 45 quiet days',
  },
  dead: {
    label: 'Remembered',
    face: '·',
    note: 'This life is complete. Its history cannot be rewritten.',
    next: 'You may adopt a new pet',
  },
};

const EMPTY_PROFILE_HEALTH: ProfileHealth = {
  score: 0,
  max: PROFILE_HEALTH_MAX,
  tier: 'incomplete',
  checks: [],
};

const app = document.querySelector<HTMLElement>('#app') as HTMLElement;
if (!app) throw new Error('Missing app root');

let connectedPubkey = '';
let viewedPubkey = '';
let pubkey = '';
let accountName = '';
let accountFollows: string[] = [];
let births: Birth[] = [];
let notes: NostrEvent[] = [];
let profileEvents: NostrEvent[] = [];
let verifiedMedicineIds = new Set<string>();
let activeBirth: Birth | null = null;
let appearance: Appearance = { ...DEFAULT_APPEARANCE };
let health: Health | null = null;
let profileHealth: ProfileHealth = { ...EMPTY_PROFILE_HEALTH };
let fallbackRelayUrls: string[] = [];
let readRelayHints: string[] = [];
let relayPlanSource: RelayPlanSource = 'pending';
let incompleteSync = false;
let loading = true;
let actionBusy = false;
let message = '';
let modal: Modal = null;
let sidePanelHidden = false;
let previewState: PetState | null = null;
let doctorCandidates: DoctorCandidate[] = [];
let doctorSource: DoctorSource = null;
let doctorLoading = false;
let eventRouting: EventRouting = eventRoutingFromConfig({});
let identitySubscription: Subscription | null = null;
let themeSubscription: Subscription | null = null;
let healthTimer: number | null = null;
let activityRefreshTimer: number | null = null;
let loadGeneration = 0;
let liveSession: LiveSessionManager | null = null;
let liveAggregator: LiveSignalAggregator | null = null;
let liveStatusUnsubscribe: (() => void) | null = null;
let liveRetryTimer: number | null = null;
let liveRetryAttempt = 0;
let liveUnavailable = false;
const failedLiveChannels = new Set<LiveChannelId>();
let emotionUnsubscribe: (() => void) | null = null;
let speechUnsubscribe: (() => void) | null = null;
let reactionFrame: number | null = null;
let reactionEnrichmentGeneration = 0;
const emotionController = new PetEmotionController({
  reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
});
const speechController = new PetSpeechController();
const reactionMetadataLoader = new ReactionMetadataLoader({
  lookupProfile: lookupReactionProfile,
});

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function shortKey(value: string): string {
  return value ? `${value.slice(0, 7)}…${value.slice(-5)}` : 'signed out';
}

function publicNpub(value: string): string {
  if (!/^[0-9a-f]{64}$/i.test(value)) return value;
  try {
    return npubEncode(value.toLowerCase());
  } catch {
    return value;
  }
}

function shortNpub(value: string): string {
  const encoded = publicNpub(value);
  return encoded.startsWith('npub1')
    ? `${encoded.slice(0, 12)}…${encoded.slice(-8)}`
    : shortKey(value);
}

function isViewingAnotherPet(): boolean {
  return isReadOnlyView(viewedPubkey, connectedPubkey);
}

function canWriteForCurrentPet(): boolean {
  return Boolean(
    connectedPubkey &&
      pubkey === connectedPubkey &&
      !isViewingAnotherPet(),
  );
}

function tagValue(event: NostrEvent, key: string): string | undefined {
  return event.tags.find((tag) => tag[0] === key)?.[1];
}

function hasReplyTag(event: NostrEvent): boolean {
  return event.tags.some((tag) => tag[0] === 'e');
}

function isAllowedPalette(value: unknown): value is Palette {
  return value === 'peach' || value === 'mint' || value === 'night';
}

function isAllowedEyes(value: unknown): value is Eyes {
  return value === 'round' || value === 'sleepy' || value === 'sparkle';
}

function isAllowedAccessory(value: unknown): value is Accessory {
  return value === 'none' || value === 'bow' || value === 'hat';
}

function safeAppearance(value: unknown): Appearance {
  if (!value || typeof value !== 'object') return { ...DEFAULT_APPEARANCE };
  const candidate = value as Partial<Appearance>;
  return {
    base: 'momo-01',
    palette: isAllowedPalette(candidate.palette) ? candidate.palette : 'peach',
    eyes: isAllowedEyes(candidate.eyes) ? candidate.eyes : 'round',
    accessory: isAllowedAccessory(candidate.accessory) ? candidate.accessory : 'none',
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function latestEvent(events: NostrEvent[], ...kinds: number[]): NostrEvent | null {
  return (
    events
      .filter((event) => kinds.includes(event.kind))
      .sort((a, b) => b.created_at - a.created_at)[0] ?? null
  );
}

function profileFromEvent(event: NostrEvent | null): ProfileData | null {
  if (!event) return null;
  try {
    const metadata = JSON.parse(event.content) as Record<string, unknown>;
    return {
      name: stringValue(metadata.name),
      displayName:
        stringValue(metadata.display_name) || stringValue(metadata.displayName),
      about: stringValue(metadata.about),
      picture: stringValue(metadata.picture),
      banner: stringValue(metadata.banner),
      nip05: stringValue(metadata.nip05),
      lud16: stringValue(metadata.lud16),
      website: stringValue(metadata.website),
    };
  } catch {
    return null;
  }
}

function relaysFromEvent(event: NostrEvent | null): RelayPermissions | null {
  if (!event) return null;
  const relays: RelayPermissions = {};
  for (const tag of event.tags) {
    if (tag[0] !== 'r' || !tag[1]) continue;
    const marker = tag[2];
    relays[tag[1]] = {
      read: marker !== 'write',
      write: marker !== 'read',
    };
  }
  return relays;
}

function followsFromEvent(event: NostrEvent | null): string[] | null {
  if (!event) return null;
  return [
    ...new Set(
      event.tags
        .filter((tag) => tag[0] === 'p' && tag[1])
        .map((tag) => tag[1]),
    ),
  ];
}

function parseAddress(value: string): { name: string; domain: string } | null {
  const input = value.trim().toLowerCase();
  const parts = input.includes('@') ? input.split('@') : ['_', input];
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !/^[a-z0-9.-]+$/i.test(parts[1]) ||
    !parts[1].includes('.')
  ) {
    return null;
  }
  return { name: parts[0], domain: parts[1] };
}

async function openHabitatSource(): Promise<void> {
  try {
    const result = await link.open(GIGI_PROFILE_HEALTH_URL, {
      label: "Open Gigi's Profile Health project",
    });
    if (result.status === 'opened') {
      message = 'Link sent to Paja. If no tab opened, use the project address shown here.';
      render();
    } else {
      message = 'The shell did not open the Habitat source.';
      render();
    }
  } catch {
    message = 'The Habitat source is unavailable in this shell.';
    render();
  }
}

async function readJsonResource(url: string): Promise<Record<string, unknown>> {
  const blob = await resource.bytes(url);
  const parsed: unknown = JSON.parse(await blob.text());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JSON response');
  }
  return parsed as Record<string, unknown>;
}

async function checkNip05(value: string, owner: string): Promise<ProfileCheck> {
  if (!value) {
    return { label: 'NIP-05', status: 'fail', detail: 'Not set', point: false };
  }
  const address = parseAddress(value);
  if (!address) {
    return {
      label: 'NIP-05',
      status: 'warn',
      detail: `${value} is not a valid identifier`,
      point: false,
    };
  }
  try {
    const data = await readJsonResource(
      `https://${address.domain}/.well-known/nostr.json?name=${encodeURIComponent(address.name)}`,
    );
    const names = data.names;
    const resolved =
      names && typeof names === 'object'
        ? (names as Record<string, unknown>)[address.name]
        : undefined;
    return resolved === owner
      ? { label: 'NIP-05', status: 'pass', detail: value, point: true }
      : {
          label: 'NIP-05',
          status: 'warn',
          detail: `${value} does not resolve to this profile`,
          point: false,
        };
  } catch {
    return {
      label: 'NIP-05',
      status: 'unavailable',
      detail: `${value} could not be assessed in this runtime`,
      point: false,
      assessed: false,
    };
  }
}

async function checkLightning(value: string): Promise<ProfileCheck> {
  if (!value) {
    return {
      label: 'Lightning address',
      status: 'fail',
      detail: 'Not set',
      point: false,
    };
  }
  const address = parseAddress(value);
  if (!address || address.name === '_') {
    return {
      label: 'Lightning address',
      status: 'warn',
      detail: `${value} is not valid`,
      point: false,
    };
  }
  try {
    const data = await readJsonResource(
      `https://${address.domain}/.well-known/lnurlp/${encodeURIComponent(address.name)}`,
    );
    return stringValue(data.callback)
      ? { label: 'Lightning address', status: 'pass', detail: value, point: true }
      : {
          label: 'Lightning address',
          status: 'warn',
          detail: `${value} returned no callback`,
          point: false,
        };
  } catch {
    return {
      label: 'Lightning address',
      status: 'unavailable',
      detail: `${value} could not be assessed in this runtime`,
      point: false,
      assessed: false,
    };
  }
}

function profileDomain(nip05: string): string {
  const address = parseAddress(nip05);
  return address?.name === '_' ? address.domain : '';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function checkProfileImage(
  label: string,
  rawUrl: string,
  ownDomain: string,
): Promise<ProfileCheck> {
  if (!rawUrl) {
    return { label, status: 'fail', detail: 'Not set', point: false };
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (url.protocol !== 'https:') throw new Error('Unsupported URL');
  } catch {
    return { label, status: 'fail', detail: 'Invalid URL', point: false };
  }

  try {
    const blob = await resource.bytes(rawUrl);
    const host = url.hostname.toLowerCase();
    const hosting = BLOSSOM_HOSTS.has(host)
      ? 'Blossom'
      : ownDomain && host === ownDomain
        ? 'own domain'
        : 'third-party host';
    const tooLarge = blob.size > 1024 * 1024;
    const trusted = hosting !== 'third-party host';
    return {
      label,
      status: trusted && !tooLarge ? 'pass' : 'warn',
      detail: `${hosting} · ${formatBytes(blob.size)}${tooLarge ? ' · large file' : ''}`,
      point: trusted,
    };
  } catch {
    return {
      label,
      status: 'unavailable',
      detail: 'Could not assess the image in this runtime',
      point: false,
      assessed: false,
    };
  }
}

function checkProfileMetadata(profile: ProfileData | null): ProfileCheck {
  if (!profile) {
    return {
      label: 'Profile',
      status: 'fail',
      detail: 'No kind 0 profile found',
      point: false,
    };
  }
  const present = PROFILE_FIELDS.filter((field) => stringValue(profile[field])).length;
  const missing = PROFILE_FIELDS.length - present;
  return {
    label: 'Profile',
    status: present >= 3 ? 'pass' : present > 0 ? 'warn' : 'fail',
    detail: `${present}/5 fields${missing ? ` · ${missing} missing` : ' · complete'}`,
    point: present > 0,
  };
}

function checkRelays(
  relays: RelayPermissions,
  dmEvent: NostrEvent | null,
): ProfileCheck {
  const entries = Object.values(relays);
  const read = entries.filter((relay) => relay.read).length;
  const write = entries.filter((relay) => relay.write).length;
  const dmCount =
    dmEvent?.tags.filter((tag) => tag[0] === 'relay' && tag[1]).length ?? 0;
  return {
    label: 'Relay setup',
    status: entries.length >= 2 ? (dmCount ? 'pass' : 'warn') : entries.length ? 'warn' : 'fail',
    detail: `${entries.length} public · ${read} read · ${write} write · ${
      dmCount ? `${dmCount} DM` : 'no DM list'
    }`,
    point: entries.length >= 2,
  };
}

function checkFollows(follows: string[]): ProfileCheck {
  return follows.length
    ? {
        label: 'Follow list',
        status: 'pass',
        detail: `${follows.length} ${follows.length === 1 ? 'follow' : 'follows'}`,
        point: true,
      }
    : {
        label: 'Follow list',
        status: 'fail',
        detail: 'No follows found',
        point: false,
      };
}

function checkWallet(
  walletEvent: NostrEvent | null,
  nutzapEvent: NostrEvent | null,
): ProfileCheck {
  if (!walletEvent) {
    return {
      label: 'NIP-60 wallet',
      status: 'fail',
      detail: 'No wallet event found',
      point: false,
    };
  }
  return {
    label: 'NIP-60 wallet',
    status: nutzapEvent ? 'pass' : 'warn',
    detail: `${walletEvent.kind === 37_375 ? 'legacy wallet' : 'wallet found'} · ${
      nutzapEvent ? 'nutzaps ready' : 'no nutzap info'
    }`,
    point: true,
  };
}

async function calculateProfileHealth(
  owner: string,
  profile: ProfileData | null,
  follows: string[],
  relays: RelayPermissions,
  events: NostrEvent[],
): Promise<ProfileHealth> {
  const ownDomain = profileDomain(stringValue(profile?.nip05));
  const [nip05, picture, banner, lightning] = await Promise.all([
    checkNip05(stringValue(profile?.nip05), owner),
    checkProfileImage('Profile picture', stringValue(profile?.picture), ownDomain),
    checkProfileImage('Banner', stringValue(profile?.banner), ownDomain),
    checkLightning(stringValue(profile?.lud16)),
  ]);
  const checks = [
    checkProfileMetadata(profile),
    nip05,
    picture,
    banner,
    lightning,
    checkRelays(relays, latestEvent(events, 10_050)),
    checkFollows(follows),
    checkWallet(latestEvent(events, 17_375, 37_375), latestEvent(events, 10_019)),
  ];
  const scored = scoreProfileChecks(checks);
  return {
    ...scored,
    checks,
  };
}

function parseBirth(event: NostrEvent): Birth | null {
  if (event.kind !== 78 || tagValue(event, 'd') !== BIRTH_D) return null;
  if (event.created_at > nowSeconds() + FUTURE_TOLERANCE) return null;

  try {
    const candidate = JSON.parse(event.content) as Partial<PetData>;
    if (candidate.v !== 1 || candidate.species !== 'momo') return null;
    const name = String(candidate.name ?? '').trim().slice(0, 28);
    if (!name) return null;
    return {
      event,
      previousId: tagValue(event, 'e'),
      data: {
        v: 1,
        name,
        species: 'momo',
        appearance: safeAppearance(candidate.appearance),
        ruleset: 'gentle-v1',
      },
    };
  } catch {
    return null;
  }
}

function latestHabitatChangeAt(birth: Birth, at: number): number {
  return profileEvents
    .filter(
      (event) =>
        HABITAT_EVENT_KINDS.has(event.kind) &&
        event.created_at >= birth.event.created_at &&
        event.created_at <= at,
    )
    .reduce(
      (latest, event) => Math.max(latest, event.created_at),
      birth.event.created_at,
    );
}

function latestMedicineAt(birth: Birth, at: number): number {
  return notes
    .filter(
      (event) =>
        verifiedMedicineIds.has(event.id) &&
        event.created_at >= birth.event.created_at &&
        event.created_at <= at,
    )
    .reduce(
      (latest, event) => Math.max(latest, event.created_at),
      birth.event.created_at,
    );
}

function reduceHealth(birth: Birth, at: number): Health {
  const activity = reduceActivityHealth({
    birthCreatedAt: birth.event.created_at,
    ownerPubkey: pubkey,
    notes,
    verifiedMedicineIds,
    at,
    daySeconds: DAY,
  });
  const habitat = reduceHabitatSickness({
    incomplete: profileHealth.tier === 'incomplete',
    birthCreatedAt: birth.event.created_at,
    lastHabitatChangeAt: latestHabitatChangeAt(birth, at),
    lastMedicineAt: latestMedicineAt(birth, at),
    at,
    daySeconds: DAY,
  });
  return {
    ...activity,
    state: applyHabitatSickness(activity.state, habitat.sick),
    activityState: activity.state,
    canFeed: activity.canFeed && !habitat.sick,
    habitatSick: habitat.sick,
    habitatDaysIncomplete: habitat.daysIncomplete,
  };
}

function resolveLineage(): Birth | null {
  const sorted = [...births].sort(
    (a, b) => a.event.created_at - b.event.created_at || a.event.id.localeCompare(b.event.id),
  );
  if (!sorted.length) return null;

  let current = sorted.find((birth) => !birth.previousId) ?? sorted[0];
  const visited = new Set([current.event.id]);

  while (true) {
    const successor = sorted.find(
      (candidate) =>
        !visited.has(candidate.event.id) &&
        candidate.previousId === current.event.id &&
        candidate.event.created_at >= current.event.created_at &&
        reduceHealth(current, candidate.event.created_at).state === 'dead',
    );
    if (!successor) return current;
    current = successor;
    visited.add(current.event.id);
  }
}

function directReplyTarget(event: NostrEvent): { id: string; pubkey: string; relay: string } | null {
  const eventTags = event.tags.filter((tag) => tag[0] === 'e' && tag[1]);
  const marked = eventTags.find((tag) => tag[3] === 'reply');
  const target = marked ?? eventTags.at(-1);
  const targetPubkey = event.tags.find(
    (tag) => tag[0] === 'p' && tag[1] && tag[1] !== pubkey,
  )?.[1];
  if (!target?.[1] || !targetPubkey) return null;
  return { id: target[1], pubkey: targetPubkey, relay: target[2] ?? '' };
}

async function verifyMedicineEvents(events: NostrEvent[]): Promise<Set<string>> {
  const candidates = events
    .filter((event) => event.pubkey === pubkey && hasReplyTag(event))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 40);
  const accepted = new Set<string>();

  await Promise.all(
    candidates.map(async (event) => {
      const target = directReplyTarget(event);
      if (!target) return;
      try {
        const result = await getPetEvent(target.id, {
          author: target.pubkey,
          relays:
            !eventRouting.localRelayOnly && target.relay ? [target.relay] : undefined,
          timeoutMs: 4_000,
        });
        const parent = result.result?.event;
        if (parent?.kind === 1 && parent.pubkey === target.pubkey && parent.pubkey !== pubkey) {
          accepted.add(event.id);
        }
      } catch {
        // A reply is medicine only when its parent can be verified.
      }
    }),
  );
  return accepted;
}

function profileD(eventId: string): string {
  return `${PROFILE_D_PREFIX}${eventId}`;
}

async function loadAppearance(birth: Birth): Promise<Appearance> {
  try {
    const result = await queryPetEvents(
      [{ authors: [pubkey], kinds: [30_078], '#d': [profileD(birth.event.id)], limit: 20 }],
      { authors: [pubkey], limit: 20, timeoutMs: 5_000 },
    );
    incompleteSync ||= Boolean(result.incomplete);
    const latest = result.events
      .map((item) => item.event)
      .filter((event) => event.created_at <= nowSeconds() + FUTURE_TOLERANCE)
      .sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id))[0];
    if (!latest) return birth.data.appearance;
    const parsed = JSON.parse(latest.content) as { appearance?: unknown };
    return safeAppearance(parsed.appearance);
  } catch {
    return birth.data.appearance;
  }
}

async function restorePreview(): Promise<void> {
  previewState = null;
  try {
    const saved = await storage.getItem('pet-preview-state');
    if (saved && saved in STATE_META) previewState = saved as PetState;
  } catch {
    // Optional shell storage is a convenience, never a requirement.
  }
}

async function rememberPreview(value: PetState | null): Promise<void> {
  try {
    if (value) await storage.setItem('pet-preview-state', value);
    else await storage.removeItem('pet-preview-state');
  } catch {
    // Preview persistence can fail without affecting the pet.
  }
}

async function restoreSidePanelPreference(): Promise<void> {
  try {
    const saved = await storage.getItem('pet-care-panel-visibility');
    if (saved === 'hidden' || saved === 'shown') {
      sidePanelHidden = saved === 'hidden';
      console.log('[nappagochi:layout] care panel preference restored', {
        hidden: sidePanelHidden,
      });
    }
  } catch {
    // Optional shell storage must never block the pet UI.
  }
}

async function rememberSidePanelPreference(): Promise<void> {
  try {
    await storage.setItem(
      'pet-care-panel-visibility',
      sidePanelHidden ? 'hidden' : 'shown',
    );
    console.log('[nappagochi:layout] care panel preference saved', {
      hidden: sidePanelHidden,
    });
  } catch {
    // The in-memory toggle remains usable when optional persistence fails.
  }
}

const openLiveChannel: OpenLiveChannel = (definition, onEvent, onClosed) => {
  if (eventRouting.localRelayOnly) {
    return relay.subscribe(definition.filters, onEvent, () => undefined, {
      relay: eventRouting.localRelayUrl,
    });
  }
  const subscription = outbox.subscribe(definition.filters, {
    ...(definition.authors?.length ? { authors: definition.authors } : {}),
    ...(definition.relays?.length ? { relays: definition.relays } : {}),
    limit: definition.limit,
    timeoutMs: definition.timeoutMs,
  });
  subscription.on('event', onEvent);
  subscription.on('closed', onClosed);
  return subscription;
};

function closeLiveChannels(): void {
  liveSession?.closeChannel('owner-activity');
  liveSession?.closeChannel('inbound-engagement');
}

function resetLiveDegradation(): void {
  if (liveRetryTimer !== null) window.clearTimeout(liveRetryTimer);
  liveRetryTimer = null;
  liveRetryAttempt = 0;
  liveUnavailable = false;
  failedLiveChannels.clear();
}

function handleLiveChannelStatus(status: {
  id: LiveChannelId;
  state: 'open' | 'closed';
  reason?: string;
}): void {
  if (status.state === 'closed' && status.reason === 'replaced-or-closed') return;
  if (status.state === 'open') failedLiveChannels.delete(status.id);
  else failedLiveChannels.add(status.id);

  const wasUnavailable = liveUnavailable;
  liveUnavailable = failedLiveChannels.size > 0;
  if (!liveUnavailable) {
    liveRetryAttempt = 0;
    if (liveRetryTimer !== null) window.clearTimeout(liveRetryTimer);
    liveRetryTimer = null;
  } else if (liveRetryTimer === null) {
    const delayMs = liveRetryDelay(liveRetryAttempt);
    if (delayMs === null) {
      console.log('[nappagochi:degradation] live channel retries exhausted', {
        failedChannels: [...failedLiveChannels],
      });
      if (wasUnavailable !== liveUnavailable) render();
      return;
    }
    liveRetryAttempt += 1;
    console.log('[nappagochi:degradation] live channel retry scheduled', {
      channelId: status.id,
      reason: status.reason ?? 'closed',
      attempt: liveRetryAttempt,
      delayMs,
    });
    liveRetryTimer = window.setTimeout(() => {
      liveRetryTimer = null;
      if (pubkey && activeBirth) beginLiveSubscription();
    }, delayMs);
  }
  if (wasUnavailable !== liveUnavailable) render();
}

function beginLiveSubscription(): void {
  closeLiveChannels();
  if (!liveSession || !pubkey || !activeBirth) {
    console.log('[nappagochi:live] owner activity channel not started', {
      hasSession: Boolean(liveSession),
      hasOwner: Boolean(pubkey),
      hasActiveBirth: Boolean(activeBirth),
    });
    return;
  }
  const definition: LiveChannelDefinition = {
    id: 'owner-activity',
    filters: [{ authors: [pubkey], kinds: [1] }],
    authors: [pubkey],
    ...(readRelayHints.length
      ? { relays: readRelayHints }
      : {}),
    limit: 200,
    timeoutMs: 5_000,
  };
  liveSession.replaceChannel(definition);
  liveSession.replaceChannel({
    id: 'inbound-engagement',
    // Intentionally omit kinds: this is the session feed for every event directed at the owner.
    filters: [{ '#p': [pubkey] }],
    ...(readRelayHints.length ? { relays: readRelayHints } : {}),
    limit: 500,
    timeoutMs: 5_000,
  });
}

function scheduleActivityProjectionRefresh(): void {
  if (activityRefreshTimer !== null) {
    console.log('[nappagochi:projection] activity refresh already scheduled', {
      ownerPubkey: pubkey,
      generation: loadGeneration,
    });
    return;
  }
  const generation = loadGeneration;
  const owner = pubkey;
  const birthId = activeBirth?.event.id;
  console.log('[nappagochi:projection] activity invalidated by live signal', {
    ownerPubkey: owner,
    birthId,
    generation,
    debounceMs: 250,
  });
  activityRefreshTimer = window.setTimeout(() => {
    activityRefreshTimer = null;
    void refreshActivityProjection(generation, owner, birthId);
  }, 250);
}

async function refreshActivityProjection(
  generation: number,
  owner: string,
  birthId?: string,
): Promise<void> {
  if (!owner || !birthId) return;
  console.log('[nappagochi:projection] activity history refresh started', {
    ownerPubkey: owner,
    birthId,
    generation,
  });
  try {
    const result = await queryPetEvents([{ authors: [owner], kinds: [1], limit: 500 }], {
      authors: [owner],
      limit: 500,
      timeoutMs: 8_000,
    });
    if (
      generation !== loadGeneration ||
      owner !== pubkey ||
      birthId !== activeBirth?.event.id
    ) {
      console.log('[nappagochi:projection] stale activity refresh discarded', {
        ownerPubkey: owner,
        birthId,
        requestedGeneration: generation,
        activeGeneration: loadGeneration,
      });
      return;
    }
    // Preserve already accepted local publishes if a relay query is briefly stale.
    notes = mergeEventHistory(notes, result.events.map((item) => item.event));
    verifiedMedicineIds = await verifyMedicineEvents(notes);
    if (generation !== loadGeneration || owner !== pubkey) return;
    if (activeBirth) health = reduceHealth(activeBirth, nowSeconds());
    incompleteSync = incompleteSync || Boolean(result.incomplete);
    console.log('[nappagochi:projection] activity history refresh applied', {
      ownerPubkey: owner,
      birthId,
      generation,
      noteCount: notes.length,
      verifiedMedicineCount: verifiedMedicineIds.size,
      healthState: health?.state ?? null,
      incomplete: Boolean(result.incomplete),
    });
    render();
  } catch (error) {
    // A live hint cannot replace the last good historical projection.
    console.log('[nappagochi:projection] activity history refresh failed; last projection retained', {
      ownerPubkey: owner,
      birthId,
      generation,
      reason: error instanceof Error ? error.message : 'unknown-error',
    });
  }
}

function handleLiveDelivery(delivery: LiveDelivery): void {
  const { channelId, event, receivedAt } = delivery;
  const signal = channelId === 'owner-activity'
    ? event.pubkey === pubkey
      ? classifyOwnerActivityDelivery({ event, receivedAt })
      : null
    : channelId === 'inbound-engagement'
      ? classifyInboundDelivery({ event, ownerPubkey: pubkey, receivedAt })
      : null;
  if (!signal) {
    console.log('[nappagochi:live] accepted delivery produced no reaction signal', {
      channelId,
      eventId: event.id,
      kind: event.kind,
    });
    return;
  }
  console.log('[nappagochi:live] reaction signal classified', {
    signalId: signal.id,
    eventId: signal.eventId,
    type: signal.type,
    actorPubkey: signal.actorPubkey,
    zapAmountSats: signal.zap?.amountSats,
    zapSenderPubkey: signal.zap?.senderPubkey,
  });
  liveAggregator?.push(signal);
  if (channelId === 'owner-activity') scheduleActivityProjectionRefresh();
}

async function refreshDerivedState(reverifyMedicine = true): Promise<void> {
  if (reverifyMedicine) {
    verifiedMedicineIds = await verifyMedicineEvents(notes);
  }
  activeBirth = resolveLineage();
  if (activeBirth) {
    health = reduceHealth(activeBirth, nowSeconds());
  }
  render();
}

async function getIdentityRelays(ownerIsSigner: boolean): Promise<RelayPermissions> {
  if (eventRouting.localRelayOnly) {
    return {
      [eventRouting.localRelayUrl]: { read: true, write: true },
    };
  }
  if (!ownerIsSigner) return {};
  try {
    return await identity.getRelays();
  } catch {
    return {};
  }
}

async function queryPetEvents(
  filters: NostrFilter[],
  options?: OutboxQueryOptions,
): Promise<OutboxResult> {
  const routedOptions =
    readRelayHints.length && !eventRouting.localRelayOnly
      ? {
          ...options,
          relays: uniqueRelayUrls([
            ...(options?.relays ?? []),
            ...readRelayHints,
          ]),
        }
      : options;
  return queryEventsWithRouting(
    eventRouting,
    (currentFilters) => relay.query(currentFilters),
    (currentFilters, currentOptions) => outbox.query(currentFilters, currentOptions),
    filters,
    routedOptions,
  );
}

async function lookupReactionProfile(pubkey: string): Promise<CommonProfileData | null> {
  try {
    const result = await common.getProfile(pubkey);
    console.log('[nappagochi:enrichment] NAP-COMMON profile lookup returned', {
      actorPubkey: pubkey,
      ok: result.ok,
      hasProfile: Boolean(result.profile),
    });
    if (result.ok) return result.profile ?? null;
  } catch (error) {
    console.log('[nappagochi:enrichment] NAP-COMMON profile lookup failed', {
      actorPubkey: pubkey,
      reason: error instanceof Error ? error.message : 'lookup-failed',
    });
  }

  console.log('[nappagochi:enrichment] using outbox kind 0 fallback', {
    actorPubkey: pubkey,
  });
  const result = await outbox.query(
    [{ authors: [pubkey], kinds: [0], limit: 1 }],
    { authors: [pubkey], limit: 1, timeoutMs: 700 },
  );
  const event = result.events
    .map((item) => item.event)
    .filter((candidate) => candidate.kind === 0 && candidate.pubkey === pubkey)
    .sort((left, right) => right.created_at - left.created_at)[0] ?? null;
  const profile = profileFromEvent(event);
  return profile ? { ...profile } : null;
}

async function getPetEvent(
  eventId: string,
  options?: OutboxEventOptions,
) {
  const routedOptions =
    readRelayHints.length && !eventRouting.localRelayOnly
      ? {
          ...options,
          relays: uniqueRelayUrls([
            ...(options?.relays ?? []),
            ...readRelayHints,
          ]),
        }
      : options;
  return getEventWithRouting(
    eventRouting,
    (filters) => relay.query(filters),
    (currentEventId, currentOptions) => outbox.getEvent(currentEventId, currentOptions),
    eventId,
    routedOptions,
  );
}

async function prepareReadRelayPlan(owner: string): Promise<void> {
  if (eventRouting.localRelayOnly) {
    readRelayHints = [eventRouting.localRelayUrl];
    relayPlanSource = 'local-only';
    return;
  }
  if (!eventRouting.localRelayMirror) {
    readRelayHints = [];
    relayPlanSource = 'normal';
    return;
  }

  let plan: OutboxRelayPlan | null = null;
  try {
    plan = await outbox.resolveRelays({
      authors: [owner],
      direction: 'read',
    });
  } catch {
    plan = null;
  }
  readRelayHints = hybridReadRelayHints(
    eventRouting,
    plan,
    DEFAULT_PUBLISH_RELAYS,
  );
  relayPlanSource =
    plan?.source === 'nip65' &&
    (plan.missingAuthors?.length ?? 0) === 0
      ? 'nip65'
      : 'fallback';
}

async function setupEventRouting(): Promise<void> {
  eventRouting = eventRoutingFromConfig({});
  try {
    eventRouting = eventRoutingFromConfig(await config.get());
  } catch {
    eventRouting = eventRoutingFromConfig({});
  }
}

async function load(): Promise<void> {
  loadGeneration += 1;
  // Any pending optional reaction context belongs to the previous pet/session.
  reactionEnrichmentGeneration += 1;
  loading = true;
  message = '';
  incompleteSync = false;
  pubkey = viewedPubkey || connectedPubkey;
  resetLiveDegradation();
  closeLiveChannels();
  render();

  try {
    connectedPubkey = await identity.getPublicKey();
    if (viewedPubkey && viewedPubkey === connectedPubkey) viewedPubkey = '';
    pubkey = viewedPubkey || connectedPubkey;
    if (!pubkey) {
      accountName = '';
      accountFollows = [];
      births = [];
      notes = [];
      profileEvents = [];
      activeBirth = null;
      health = null;
      profileHealth = { ...EMPTY_PROFILE_HEALTH };
      fallbackRelayUrls = [];
      readRelayHints = [];
      relayPlanSource = 'pending';
      loading = false;
      render();
      return;
    }

    const ownerIsSigner = pubkey === connectedPubkey;
    await prepareReadRelayPlan(pubkey);
    const profilePromise = eventRouting.localRelayOnly || !ownerIsSigner
      ? Promise.resolve(null)
      : identity.getProfile().catch((error) => {
          console.log('[nappagochi:degradation] identity profile unavailable; using outbox metadata', {
            reason: error instanceof Error ? error.message : 'profile-unavailable',
          });
          return null;
        });
    const followsPromise = eventRouting.localRelayOnly || !ownerIsSigner
      ? Promise.resolve([] as string[])
      : identity.getFollows().catch(() => [] as string[]);
    const relaysPromise = getIdentityRelays(ownerIsSigner);
    const profileHealthEventsPromise = queryPetEvents(
      [
        {
          authors: [pubkey],
          kinds: [0, 3, 10_002, 10_019, 10_050, 17_375, 37_375],
          limit: 20,
        },
      ],
      { authors: [pubkey], limit: 20, timeoutMs: 8_000 },
    );
    const birthPromise = queryPetEvents(
      [{ authors: [pubkey], kinds: [78], '#d': [BIRTH_D], limit: 100 }],
      { authors: [pubkey], limit: 100, timeoutMs: 6_000 },
    );
    const notePromise = queryPetEvents([{ authors: [pubkey], kinds: [1], limit: 500 }], {
      authors: [pubkey],
      limit: 500,
      timeoutMs: 8_000,
    });

    const [profile, follows, identityRelays, profileHealthResult, birthResult, noteResult] =
      await Promise.all([
        profilePromise,
        followsPromise,
        relaysPromise,
        profileHealthEventsPromise,
        birthPromise,
        notePromise,
      ]);
    profileEvents = profileHealthResult.events.map((item) => item.event);
    const relayListEvent = latestEvent(profileEvents, 10_002);
    const eventProfile = profileFromEvent(latestEvent(profileEvents, 0));
    const eventFollows = followsFromEvent(latestEvent(profileEvents, 3));
    const currentProfile = eventProfile ?? profile;
    const currentFollows = eventFollows ?? follows;
    const currentRelays = relaysFromEvent(relayListEvent) ?? identityRelays;
    accountFollows = currentFollows;

    if (!ownerIsSigner) {
      fallbackRelayUrls = [];
    } else if (eventRouting.localRelayOnly) {
      fallbackRelayUrls = [eventRouting.localRelayUrl];
    } else {
      const writableIdentityRelays = Object.entries(identityRelays)
        .filter(([, permissions]) => permissions.write)
        .map(([url]) => url);
      fallbackRelayUrls = uniqueRelayUrls(
        [
          ...(eventRouting.localRelayMirror ? [eventRouting.localRelayUrl] : []),
          ...(writableIdentityRelays.length
            ? writableIdentityRelays
            : DEFAULT_PUBLISH_RELAYS),
        ],
      );
    }
    profileHealth = await calculateProfileHealth(
      pubkey,
      currentProfile,
      currentFollows,
      currentRelays,
      profileEvents,
    );
    accountName = profileLabel(currentProfile);
    incompleteSync = Boolean(
      profileHealthResult.incomplete || birthResult.incomplete || noteResult.incomplete,
    );
    births = birthResult.events
      .map((item) => parseBirth(item.event))
      .filter((birth): birth is Birth => Boolean(birth));
    notes = noteResult.events.map((item) => item.event);
    verifiedMedicineIds = await verifyMedicineEvents(notes);
    activeBirth = resolveLineage();
    health = activeBirth ? reduceHealth(activeBirth, nowSeconds()) : null;
    appearance = activeBirth ? await loadAppearance(activeBirth) : { ...DEFAULT_APPEARANCE };
    if (isViewingAnotherPet()) previewState = null;
    else await restorePreview();
    beginLiveSubscription();
  } catch (error) {
    message = error instanceof Error ? error.message : 'The Nostr history could not be loaded.';
  } finally {
    loading = false;
    render();
  }
}

function profileLabel(profile: ProfileData | null): string {
  return profile?.displayName?.trim() || profile?.name?.trim() || 'Nostr account';
}

function uniqueRelayUrls(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => /^wss?:\/\/[^/\s]+/i.test(value)),
    ),
  ];
}

function profileTierLabel(tier: ProfileTier): string {
  if (tier === 'excellent') return 'Excellent';
  if (tier === 'healthy') return 'Healthy';
  if (tier === 'attention') return 'Needs attention';
  return 'Incomplete';
}

function displayedCondition(state: PetState): { label: string; note: string } {
  if (
    state === 'sick' &&
    health?.habitatSick &&
    (health.activityState === 'happy' ||
      health.activityState === 'content' ||
      health.activityState === 'lonely')
  ) {
    return {
      label: 'Sick',
      note: `Its habitat has remained incomplete for ${HABITAT_SICK_AFTER_DAYS} days. Medicine can help it recover.`,
    };
  }
  if (state === 'happy') {
    if (profileHealth.tier === 'excellent') {
      return {
        label: 'Radiant',
        note: 'Bright-eyed, active, and flourishing in an excellent Nostr habitat.',
      };
    }
    if (profileHealth.tier === 'healthy') return STATE_META.happy;
    if (profileHealth.tier === 'attention') {
      return {
        label: 'Unsettled',
        note: 'Active and safe, but its Nostr habitat could use a little care.',
      };
    }
    return {
      label: 'Fragile',
      note: 'Active and alive, though its Nostr habitat is still very sparse.',
    };
  }
  if (state === 'content') {
    if (profileHealth.tier === 'excellent' || profileHealth.tier === 'healthy') {
      return STATE_META.content;
    }
    if (profileHealth.tier === 'attention') {
      return {
        label: 'Unsettled',
        note: 'Cozy for now, with a few gaps in its Nostr habitat.',
      };
    }
    return {
      label: 'Fragile',
      note: 'Calm for now, but its Nostr habitat needs more support.',
    };
  }
  return STATE_META[state];
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp * 1000);
}

function formatRelative(timestamp: number): string {
  const elapsed = Math.max(0, nowSeconds() - timestamp);
  if (elapsed < 60) return 'just now';
  if (elapsed < 3_600) return `${Math.floor(elapsed / 60)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / 3_600)}h ago`;
  return `${Math.floor(elapsed / DAY)}d ago`;
}

function effectiveState(): PetState {
  return previewState ?? health?.state ?? 'happy';
}

function petMarkup(
  state: PetState,
  petAppearance: Appearance,
  conditionLabel = STATE_META[state].label,
): string {
  const accessory =
    petAppearance.accessory === 'bow'
      ? '<span class="pet-accessory bow" aria-hidden="true">◆</span>'
      : petAppearance.accessory === 'hat'
        ? '<span class="pet-accessory hat" aria-hidden="true"></span>'
        : '';
  const eye = petAppearance.eyes === 'sleepy' ? '⌒' : petAppearance.eyes === 'sparkle' ? '✦' : '●';
  const poseStyle = petPoseStyle(resolvePetPose({ condition: state }));
  const speech = speechController.snapshot().utterance;

  return `
    <span class="pet-speech${speech ? ' pet-speech--visible' : ''}" role="status"
      aria-live="polite">${speech ? escapeHtml(speech.text) : ''}</span>
    <div class="pet pet--${state} palette--${petAppearance.palette}" style="${poseStyle}" role="img"
      aria-label="${escapeHtml(conditionLabel)} Nostr pet">
      <span class="pet-shadow"></span>
      <span class="pet-ear pet-ear--left"></span>
      <span class="pet-ear pet-ear--right"></span>
      <span class="pet-body">
        ${accessory}
        <span class="pet-cheek pet-cheek--left"></span>
        <span class="pet-cheek pet-cheek--right"></span>
        <span class="pet-eye pet-eye--left">${eye}</span>
        <span class="pet-eye pet-eye--right">${eye}</span>
        <span class="pet-mouth">${STATE_META[state].face}</span>
        <span class="pet-patch"></span>
      </span>
      <span class="pet-signal" aria-hidden="true">⌁</span>
    </div>
  `;
}

function shellHeader(): string {
  const accountNpub = publicNpub(pubkey);
  const hybridTitle =
    relayPlanSource === 'nip65'
      ? 'Hybrid mode: NIP-65 author relays plus the local persistence mirror'
      : relayPlanSource === 'fallback'
        ? 'Hybrid mode: no NIP-65 relay list was resolved, so reads and publishes use local plus public fallback relays'
        : 'Hybrid mode: resolving NIP-65, with local plus public fallback coverage';
  const relayModePill = eventRouting.localRelayOnly
    ? '<span class="local-relay-pill" title="Debug mode: reads and publishes use only the configured loopback relay">local only</span>'
    : eventRouting.localRelayMirror
      ? `<span class="hybrid-relay-pill" title="${escapeHtml(hybridTitle)}">hybrid</span>`
      : '';
  const viewerPill = isViewingAnotherPet()
    ? '<span class="viewer-pill">viewing</span>'
    : '';
  return `
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">⌁</span>
        <span>Nappagochi</span>
        <span class="prototype-pill">prototype</span>
      </div>
      <div class="account">
        ${relayModePill}
        ${viewerPill}
        ${liveUnavailable ? '<span class="live-paused-pill" title="Live reactions are temporarily unavailable; historical pet state is still active">live paused</span>' : ''}
        ${incompleteSync ? '<span class="sync-pill" title="Some relay results were incomplete">partial sync</span>' : ''}
        ${
          pubkey
            ? `<span class="account-identity">
                <span class="account-name">${escapeHtml(accountName || 'Nostr account')}</span>
                <span class="account-npub" title="${escapeHtml(accountNpub)}">${escapeHtml(accountNpub)}</span>
              </span>`
            : '<span class="account-name">signed out</span>'
        }
        <button class="view-mode-button" type="button" data-action="view-pet">View pet</button>
        <span class="account-dot ${isViewingAnotherPet() ? 'account-dot--viewing' : ''}" aria-hidden="true"></span>
      </div>
    </header>
  `;
}

function viewingBannerMarkup(): string {
  if (!isViewingAnotherPet()) return '';
  return `
    <section class="viewer-banner" aria-label="Read-only pet view">
      <span>
        <strong>Read-only view</strong>
        This pet belongs to <code>${escapeHtml(publicNpub(pubkey))}</code>.
        Your connected signer has not changed.
      </span>
      <button class="secondary-button" type="button" data-action="view-own-pet">
        ${connectedPubkey ? 'Back to my pet' : 'Stop viewing'}
      </button>
    </section>
  `;
}

function loadingMarkup(): string {
  const loadingLabel = eventRouting.localRelayOnly
    ? 'Finding your pet on the local relay…'
    : eventRouting.localRelayMirror
      ? 'Finding your pet through NIP-65 and the local mirror…'
      : 'Finding your pet across Nostr…';
  const loadingDetail = eventRouting.localRelayOnly
    ? 'Public relay discovery is disabled for this debug session.'
    : eventRouting.localRelayMirror
      ? 'If NIP-65 is unavailable, the shell also checks the local and public fallback relays.'
      : 'Birth, activity, and appearance events are being reconciled.';
  return `
    ${shellHeader()}
    <section class="loading-card">
      <div class="loading-orbit" aria-hidden="true"><span></span></div>
      <p>${loadingLabel}</p>
      <small>${loadingDetail}</small>
    </section>
  `;
}

function signedOutMarkup(): string {
  return `
    ${shellHeader()}
    <section class="welcome-card">
      <div class="mini-pet">${petMarkup('content', DEFAULT_APPEARANCE)}</div>
      <p class="eyebrow">Tied to your Nostr posts</p>
      <h1>Connect your Nostr signer</h1>
      <div class="sign-in-status" role="status">
        <span class="status-pulse" aria-hidden="true"></span>
        <span><strong>Waiting for a signer</strong><small>NIP-07 on desktop · Amber via Bunker on Android.</small></span>
      </div>
      <div class="viewer-entry">
        <strong>Or view a public pet without signing in</strong>
        <span>Paste an npub to inspect its Nostr-derived condition in read-only mode.</span>
        ${viewerFormMarkup('signed-out-view-form')}
      </div>
      ${eventRouting.localRelayOnly
        ? `<div class="debug-login-note">
            <strong>Local debug mode</strong>
            <span>Use <strong>Test nsec</strong> in Paja’s Signer panel. The secret stays in the local shell and never enters this pet.</span>
          </div>`
        : eventRouting.localRelayMirror
          ? `<div class="debug-login-note">
              <strong>Hybrid relay mode</strong>
              <span>NIP-65 remains primary. The loopback relay keeps a local mirror, with public relays as the missing-list fallback.</span>
            </div>`
        : ''}
    </section>
  `;
}

function adoptionMarkup(previous?: Birth): string {
  const isSuccessor = Boolean(previous);
  return `
    ${shellHeader()}
    <section class="adoption-layout">
      <div class="adoption-art">
        ${petMarkup('happy', DEFAULT_APPEARANCE)}
        <span class="spark spark--one">✦</span>
        <span class="spark spark--two">·</span>
      </div>
      <form id="adopt-form" class="adoption-card" novalidate>
        <p class="eyebrow">${
          isSuccessor
            ? 'A new chapter'
            : eventRouting.localRelayOnly
              ? 'No pet found on the local relay'
              : eventRouting.localRelayMirror
                ? 'No pet found through NIP-65, local, or public relays'
                : 'No pet found for this npub'
        }</p>
        <h1>${isSuccessor ? 'Adopt another pet' : 'Meet your Nostr companion'}</h1>
        <p>${isSuccessor
          ? `${escapeHtml(previous?.data.name)} stays in your history. This creates a separate life.`
          : 'Its birthday will be the timestamp of a signed Nostr birth event.'}</p>
        <label>
          Pet name
          <input
            name="name"
            value="Momo"
            maxlength="28"
            autocomplete="off"
            aria-describedby="pet-name-help"
            required
          />
          <small id="pet-name-help">Momo is ready, or type another name.</small>
        </label>
        <fieldset>
          <legend>First color</legend>
          <div class="swatches">
            ${paletteOptions('peach')}
          </div>
        </fieldset>
        <button class="primary-button" type="button" data-submit="adopt" ${actionBusy ? 'disabled' : ''}>
          ${actionBusy ? 'Creating signed event…' : 'Adopt this pet'}
        </button>
        <small>
          You will approve a kind 78 event in your Nostr host. Paja chooses relays
          first; fallbacks are tried only when its relay list is unavailable.
        </small>
      </form>
    </section>
  `;
}

function viewedEmptyMarkup(): string {
  return `
    ${shellHeader()}
    ${viewingBannerMarkup()}
    <section class="adoption-layout viewed-empty-layout">
      <div class="adoption-art">
        ${petMarkup('lonely', DEFAULT_APPEARANCE)}
      </div>
      <div class="adoption-card">
        <p class="eyebrow">No signed pet birth found</p>
        <h1>This npub has no visible pet</h1>
        <p>
          The local and selected Nostr relays did not return a valid
          <strong>nostr.pet.birth.v1</strong> event for this account.
        </p>
        <button class="primary-button" type="button" data-action="view-pet">
          View another npub
        </button>
        <button class="secondary-button" type="button" data-action="view-own-pet">
          ${connectedPubkey ? 'Back to my pet' : 'Stop viewing'}
        </button>
      </div>
    </section>
  `;
}

function paletteOptions(selected: Palette): string {
  const options: Array<{ id: Palette; label: string }> = [
    { id: 'peach', label: 'Peach' },
    { id: 'mint', label: 'Mint' },
    { id: 'night', label: 'Night' },
  ];
  return options
    .map(
      ({ id, label }) => `
        <label class="swatch swatch--${id}">
          <input type="radio" name="palette" value="${id}" ${selected === id ? 'checked' : ''} />
          <span aria-hidden="true"></span>
          ${label}
        </label>`,
    )
    .join('');
}

function petHomeMarkup(): string {
  if (!activeBirth || !health) return adoptionMarkup();
  if (health.state === 'dead' && modal === null && births.length > 0) {
    // The memorial remains the home view; adopting is an explicit action below.
  }

  const shownState = effectiveState();
  const lifecycleMeta = STATE_META[shownState];
  const condition = previewState ? lifecycleMeta : displayedCondition(shownState);
  const ageDays = Math.max(0, Math.floor((nowSeconds() - activeBirth.event.created_at) / DAY));
  const isPreview = Boolean(previewState);
  const readOnly = isViewingAnotherPet();
  const habitatOnlySickness =
    !isPreview &&
    health.habitatSick &&
    (health.activityState === 'happy' ||
      health.activityState === 'content' ||
      health.activityState === 'lonely');
  const nextStateCopy = habitatOnlySickness
    ? `Medicine restarts the ${HABITAT_SICK_AFTER_DAYS}-day habitat timer`
    : lifecycleMeta.next;
  const sicknessCause =
    health.state === 'sick'
      ? health.habitatSick && health.activityState === 'sick'
        ? 'Inactivity + habitat'
        : health.habitatSick
          ? 'Habitat incomplete'
          : 'Kind 1 inactivity'
      : '';
  const habitatLabel = `<button class="habitat-source-link" type="button" data-action="habitat-source"
    title="View Gigi’s Profile Health source">Habitat</button>`;
  const petStage = readOnly
    ? `<div class="pet-stage pet-stage--readonly">${petMarkup(shownState, appearance, condition.label)}</div>`
    : `<button class="pet-stage" data-action="pet-menu" aria-label="Open pet actions">${petMarkup(shownState, appearance, condition.label)}</button>`;
  const careActions = readOnly
    ? `<div class="view-only-card">
        <strong>Viewing only</strong>
        <span>Care actions and appearance changes are available only to this pet’s signer.</span>
        <button class="secondary-button" type="button" data-action="view-pet">View another npub</button>
      </div>`
    : `<div class="action-grid">
        <button class="care-button" data-action="note" ${health.state === 'dead' ? 'disabled' : ''}>
          <span>✎</span><strong>Write a note</strong><small>${health.canFeed ? 'Feeds your pet' : 'Keeps your voice active'}</small>
        </button>
        <button class="care-button care-button--doctor" data-action="doctor"
          ${health.state === 'dead' ? 'disabled' : ''}>
          <span>＋</span><strong>SAVE YOUR PET</strong><small>Get medicine</small>
        </button>
      </div>`;

  return `
    ${shellHeader()}
    ${viewingBannerMarkup()}
    <section class="pet-layout${sidePanelHidden ? ' pet-layout--compact' : ''}">
      <div class="habitat">
        <button class="panel-toggle" type="button" data-action="toggle-panel"
          aria-controls="care-panel" aria-expanded="${sidePanelHidden ? 'false' : 'true'}"
          title="${sidePanelHidden ? 'Show pet details' : 'Hide pet details'}">
          <span aria-hidden="true">${sidePanelHidden ? '‹' : '›'}</span>
          <span>${sidePanelHidden ? 'Show details' : 'Hide details'}</span>
        </button>
        <div class="ambient-shape ambient-shape--one"></div>
        <div class="ambient-shape ambient-shape--two"></div>
        ${petStage}
        <div class="state-caption">
          ${isPreview ? '<span class="preview-flag">visual preview</span>' : ''}
          <span class="state-kicker">${escapeHtml(condition.label)}</span>
          <h1>${escapeHtml(activeBirth.data.name)}</h1>
          <p>${escapeHtml(condition.note)}</p>
        </div>
      </div>

      <aside class="care-panel" id="care-panel" ${sidePanelHidden ? 'hidden' : ''}>
        <div class="care-heading">
          <div>
            <p class="eyebrow">Today’s pulse</p>
            <h2>${health.state === 'dead' ? 'Memorial' : `${health.daysQuiet} quiet ${health.daysQuiet === 1 ? 'day' : 'days'}`}</h2>
          </div>
          ${readOnly ? '' : '<button class="icon-button" data-action="settings" aria-label="Appearance settings">⚙</button>'}
        </div>

        <div class="vital-track" aria-label="Pet lifecycle">
          ${(['happy', 'content', 'lonely', 'sick', 'critical', 'dead'] as PetState[])
            .map(
              (state) =>
                `<span class="${state === health?.state ? 'active' : ''}" title="${STATE_META[state].label}"></span>`,
            )
            .join('')}
        </div>
        <div class="next-state">
          <span>${escapeHtml(nextStateCopy)}</span>
          ${readOnly ? '' : '<button class="text-button" data-action="preview">Preview states</button>'}
        </div>

        ${careActions}

        <dl class="pet-facts">
          <div><dt>Activity state</dt><dd>${escapeHtml(STATE_META[health.activityState].label)}</dd></div>
          ${sicknessCause
            ? `<div><dt>Sickness cause</dt><dd>${escapeHtml(sicknessCause)}</dd></div>`
            : ''}
          <div><dt>Born</dt><dd>${formatDate(activeBirth.event.created_at)}</dd></div>
          <div><dt>Age</dt><dd>${ageDays} ${ageDays === 1 ? 'day' : 'days'}</dd></div>
          <div><dt>Last care</dt><dd>${formatRelative(health.lastCareAt)}</dd></div>
          <div>
            <dt>${habitatLabel}</dt>
            <dd>
              <button class="text-button habitat-link" data-action="profile">
                ${profileHealth.score}/${profileHealth.max} · ${escapeHtml(profileTierLabel(profileHealth.tier))}
              </button>
            </dd>
          </div>
          <div><dt>Proof</dt><dd>${shortKey(activeBirth.event.id)}</dd></div>
        </dl>

        ${health.state === 'dead' && !readOnly
          ? `<button class="secondary-button full-width" data-action="adopt-next">Adopt a new pet</button>`
          : ''}
      </aside>
    </section>
  `;
}

function noteModalMarkup(): string {
  return modalFrame(
    'Write a Nostr note',
    `
      <p class="modal-copy">${health?.canFeed
        ? 'A top-level kind 1 note will feed your pet.'
        : 'Your pet is sick, so this note will not heal it. A reply is the medicine.'}</p>
      <p class="modal-copy">Paja’s confirmation authorizes the request; your connected signer may prompt separately. Success appears only after the signer returns an event and a relay accepts it.</p>
      <form id="note-form">
        <label>Your note
          <textarea name="content" maxlength="1000" rows="5" placeholder="What’s on your mind?" required></textarea>
        </label>
        <button class="primary-button" type="button" data-submit="note" ${actionBusy ? 'disabled' : ''}>
          ${actionBusy ? 'Publishing…' : 'Review and publish'}
        </button>
      </form>
    `,
  );
}

function doctorModalMarkup(): string {
  const sourceCopy =
    doctorSource === 'follows'
      ? 'These are recent notes from people you follow.'
      : 'No usable follow notes were found, so these are recent public Discover notes—not a universal trending ranking.';
  const candidates = doctorCandidates
    .map(
      (candidate, index) => `
        <label class="note-choice">
          <input type="radio" name="candidate" value="${index}" ${index === 0 ? 'checked' : ''} />
          <span>
            <strong title="${escapeHtml(publicNpub(candidate.event.pubkey))}">${escapeHtml(shortNpub(candidate.event.pubkey))}</strong>
            <small>${formatRelative(candidate.event.created_at)}</small>
            <em>${escapeHtml(candidate.event.content.slice(0, 180) || '(media or tag-only note)')}</em>
          </span>
        </label>`,
    )
    .join('');

  return modalFrame(
    `Help ${activeBirth?.data.name ?? 'your pet'} recover`,
    doctorLoading
      ? '<div class="doctor-loading">Finding recent notes…</div>'
      : doctorCandidates.length
        ? `
          <p class="modal-copy">Choose a note and add something thoughtful！</p>
          <p class="modal-copy">${sourceCopy}</p>
          <form id="doctor-form">
            <fieldset class="note-choices">
              <legend>${doctorSource === 'follows' ? 'From your follows' : 'Discover notes'}</legend>
              ${candidates}
            </fieldset>
            <label>Your message
              <textarea name="content" maxlength="1000" rows="4" placeholder="Add something thoughtful…" required></textarea>
            </label>
            <button class="primary-button" type="button" data-submit="doctor" ${actionBusy ? 'disabled' : ''}>
              ${actionBusy ? 'Publishing…' : 'Publish and give medicine'}
            </button>
          </form>`
        : `
          <div class="empty-state">
            <strong>No recent public notes found</strong>
            <p>Try again when your shell’s outbox routes have recent public kind 1 notes.</p>
            <button class="secondary-button" data-action="reload-doctor">Try again</button>
          </div>`,
  );
}

function habitatSourceModalMarkup(): string {
  return modalFrame(
    'About Habitat',
    `
      <p class="modal-copy">
        The Habitat score is adapted from Gigi’s Profile Health project.
      </p>
      <button class="primary-button full-width" type="button" data-action="habitat-source-open">
        Open Gigi’s project ↗
      </button>
      <label class="source-address">Project address
        <input type="text" readonly value="${escapeHtml(GIGI_PROFILE_HEALTH_URL)}" />
      </label>
      <p class="modal-copy">
        If Paja does not open a new tab, select and copy the project address above.
      </p>
    `,
  );
}

function settingsModalMarkup(): string {
  return modalFrame(
    'Pet appearance',
    `
      <form id="settings-form">
        <fieldset>
          <legend>Color</legend>
          <div class="swatches">${paletteOptions(appearance.palette)}</div>
        </fieldset>
        <div class="form-columns">
          <label>Eyes
            <select name="eyes">
              ${selectOptions(['round', 'sleepy', 'sparkle'], appearance.eyes)}
            </select>
          </label>
          <label>Accessory
            <select name="accessory">
              ${selectOptions(['none', 'bow', 'hat'], appearance.accessory)}
            </select>
          </label>
        </div>
        <p class="modal-copy">Saving publishes a replaceable kind 30078 appearance event. It does not alter the birth event.</p>
        <button
          class="primary-button"
          type="button"
          data-submit="settings"
          ${actionBusy || health?.state === 'dead' ? 'disabled' : ''}
        >
          ${health?.state === 'dead' ? 'Memorial appearance is fixed' : actionBusy ? 'Saving…' : 'Save appearance'}
        </button>
      </form>
    `,
  );
}

function selectOptions(values: string[], selected: string): string {
  return values
    .map(
      (value) =>
        `<option value="${value}" ${value === selected ? 'selected' : ''}>${value[0].toUpperCase()}${value.slice(1)}</option>`,
    )
    .join('');
}

function previewModalMarkup(): string {
  const states = (Object.keys(STATE_META) as PetState[])
    .map(
      (state) => `
        <button class="state-option ${previewState === state ? 'active' : ''}" data-preview="${state}">
          <span class="state-dot state-dot--${state}"></span>
          <span><strong>${STATE_META[state].label}</strong><small>${STATE_META[state].note}</small></span>
        </button>`,
    )
    .join('');
  return modalFrame(
    'Visual state lab',
    `
      <p class="modal-copy">Preview only changes the drawing. Your canonical Nostr-derived state remains <strong>${health ? STATE_META[health.state].label : 'unknown'}</strong>.</p>
      <div class="state-options">${states}</div>
      <button class="secondary-button full-width" data-action="clear-preview">Return to live state</button>
    `,
  );
}

function profileModalMarkup(): string {
  const checks = profileHealth.checks
    .map(
      (check) => `
        <li class="profile-check profile-check--${check.status}">
          <span class="profile-check-mark" aria-hidden="true">${
            check.status === 'pass'
              ? '✓'
              : check.status === 'warn'
                ? '!'
                : check.status === 'unavailable'
                  ? '?'
                  : '×'
          }</span>
          <span>
            <strong>${escapeHtml(check.label)}</strong>
            <small>${escapeHtml(check.detail)}</small>
          </span>
          <b aria-label="${check.assessed === false
            ? 'Excluded because it could not be assessed'
            : check.point
              ? 'Contributes one point'
              : 'No point'}">${
            check.assessed === false ? '?' : check.point ? '+1' : '—'
          }</b>
        </li>`,
    )
    .join('');
  const habitatTimer =
    health && profileHealth.tier === 'incomplete'
      ? health.habitatSick
        ? `The incomplete habitat has reached ${HABITAT_SICK_AFTER_DAYS} days and is now a sickness cause.`
        : `${Math.min(health.habitatDaysIncomplete, HABITAT_SICK_AFTER_DAYS)}/${HABITAT_SICK_AFTER_DAYS} days toward habitat sickness.`
      : 'The habitat is above the incomplete tier, so this sickness timer is not active.';

  return modalFrame(
    'Nostr habitat',
    `
      <div class="profile-score-card profile-score-card--${profileHealth.tier}">
        <span><strong>${profileHealth.score}</strong> / ${profileHealth.max}</span>
        <div>
          <b>${escapeHtml(profileTierLabel(profileHealth.tier))}</b>
          <small>Profile-health habitat score</small>
        </div>
      </div>
      <p class="modal-copy">
        This score enriches a living pet’s condition. Activity alone controls critical
        decline and irreversible death. An incomplete habitat becomes a separate sickness
        cause after ${HABITAT_SICK_AFTER_DAYS} days; medicine restarts that timer.
      </p>
      <p class="modal-copy"><strong>${escapeHtml(habitatTimer)}</strong></p>
      ${
        checks
          ? `<ul class="profile-checks">${checks}</ul>`
          : '<div class="empty-state"><strong>No profile checks loaded</strong><p>Try reopening this view after your Nostr data has synced.</p></div>'
      }
      <p class="profile-method-note">
        Eight possible checks: profile, NIP-05, picture, banner, Lightning address, relay setup,
        follows, and NIP-60 wallet. Checks unavailable in this runtime are excluded from the score.
      </p>
    `,
  );
}

function viewerFormMarkup(formId: string): string {
  return `
    <form id="${escapeHtml(formId)}" class="viewer-form" novalidate>
      <label>
        Public account
        <input
          name="npub"
          type="text"
          inputmode="text"
          placeholder="npub1…"
          autocomplete="off"
          autocapitalize="none"
          spellcheck="false"
          aria-label="Nostr npub to view"
          required
        />
      </label>
      <button class="primary-button" type="button" data-submit="view">
        View this pet
      </button>
    </form>
  `;
}

function viewerModalMarkup(): string {
  return modalFrame(
    'View another Nappagochi',
    `
      <p class="modal-copy">
        Paste a public <strong>npub</strong>. This changes only the account being
        viewed; it never changes or uses your connected signer.
      </p>
      ${viewerFormMarkup('modal-view-form')}
      <p class="security-note">
        <span><strong>Read-only:</strong> viewing cannot post, feed, heal, adopt, or edit another pet.</span>
        <span><strong>Do not paste an nsec.</strong> Private-key input is rejected.</span>
      </p>
      ${
        isViewingAnotherPet()
          ? `<button class="secondary-button full-width" type="button" data-action="view-own-pet">
              ${connectedPubkey ? 'Back to my pet' : 'Stop viewing'}
            </button>`
          : ''
      }
    `,
  );
}

function modalFrame(title: string, body: string): string {
  return `
    <div class="modal-backdrop" data-action="close-modal">
      <section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header>
          <h2 id="modal-title">${escapeHtml(title)}</h2>
          <button class="icon-button" data-action="close-modal" aria-label="Close">×</button>
        </header>
        ${body}
      </section>
    </div>
  `;
}

function modalMarkup(): string {
  if (modal === 'note') return noteModalMarkup();
  if (modal === 'doctor') return doctorModalMarkup();
  if (modal === 'settings') return settingsModalMarkup();
  if (modal === 'preview') return previewModalMarkup();
  if (modal === 'profile') return profileModalMarkup();
  if (modal === 'habitat-source') return habitatSourceModalMarkup();
  if (modal === 'viewer') return viewerModalMarkup();
  return '';
}

function hasRequiredRuntime(): boolean {
  const runtime = window.napplet;
  return Boolean(
    runtime &&
      typeof runtime.identity?.getPublicKey === 'function' &&
      typeof runtime.identity.getProfile === 'function' &&
      typeof runtime.identity.getFollows === 'function' &&
      typeof runtime.identity.onChanged === 'function' &&
      typeof runtime.outbox?.getEvent === 'function' &&
      typeof runtime.outbox.query === 'function' &&
      typeof runtime.outbox.subscribe === 'function' &&
      typeof runtime.outbox.publish === 'function',
  );
}

function render(): void {
  if (!hasRequiredRuntime()) {
    app.innerHTML = `
      <section class="runtime-guard">
        ${petMarkup('lonely', DEFAULT_APPEARANCE)}
        <h1>This prototype needs a compatible napplet host</h1>
        <p>Open the built artifact through Paja or another NIP-5D-compatible shell with identity and outbox support.</p>
      </section>`;
    return;
  }

  let content = '';
  if (loading) content = loadingMarkup();
  else if (!pubkey) content = signedOutMarkup();
  else if (!activeBirth) {
    content = isViewingAnotherPet() ? viewedEmptyMarkup() : adoptionMarkup();
  }
  else content = petHomeMarkup();

  app.innerHTML = `
    <div class="app-shell">
      ${content}
      ${message ? `<div class="toast" role="status">${escapeHtml(message)}</div>` : ''}
      ${modalMarkup()}
    </div>`;
  bindInteractions();
  syncEmotionRenderer();
}

function applyEmotionSnapshot(snapshot: PetEmotionSnapshot): void {
  const pet = document.querySelector<HTMLElement>('.pet-stage .pet');
  if (!pet) return;
  pet.setAttribute('style', petPoseStyle(snapshot.pose));
  if (snapshot.reaction) pet.dataset.reaction = snapshot.reaction;
  else delete pet.dataset.reaction;
}

function applySpeechSnapshot(snapshot: PetSpeechSnapshot): void {
  const bubble = document.querySelector<HTMLElement>('.pet-stage .pet-speech');
  if (!bubble) return;
  bubble.textContent = snapshot.utterance?.text ?? '';
  bubble.classList.toggle('pet-speech--visible', Boolean(snapshot.utterance));
  if (snapshot.utterance) bubble.dataset.intent = snapshot.utterance.intent;
  else delete bubble.dataset.intent;
}

function syncEmotionRenderer(): void {
  emotionUnsubscribe?.();
  emotionUnsubscribe = null;
  speechUnsubscribe?.();
  speechUnsubscribe = null;
  if (!activeBirth || !health) return;
  // Preview changes only the displayed pose; authoritative health still gates reactions.
  emotionController.setCondition(health.state);
  speechController.setCondition(health.state);
  // Speech remains ephemeral even when preview replaces the authoritative pose.
  speechUnsubscribe = speechController.subscribe(applySpeechSnapshot);
  if (previewState) {
    applyEmotionSnapshot({
      condition: previewState,
      mood: 'neutral',
      reaction: null,
      pose: resolvePetPose({ condition: previewState }),
    });
    return;
  }
  emotionUnsubscribe = emotionController.subscribe(applyEmotionSnapshot);
}

function animateCurrentReaction(): void {
  if (reactionFrame !== null) window.cancelAnimationFrame(reactionFrame);
  const step = () => {
    const snapshot = emotionController.snapshot();
    applyEmotionSnapshot(snapshot);
    if (snapshot.reaction) reactionFrame = window.requestAnimationFrame(step);
    else {
      reactionFrame = null;
      console.log('[nappagochi:emotion] renderer animation loop settled', {
        condition: snapshot.condition,
        mood: snapshot.mood,
      });
    }
  };
  step();
}

function bindInteractions(): void {
  bindActionForm('signed-out-view-form', 'view', handleView, true);
  bindActionForm('modal-view-form', 'view', handleView, true);
  bindActionForm('adopt-form', 'adopt', handleAdopt, true);
  bindActionForm('note-form', 'note', handleNote);
  bindActionForm('doctor-form', 'doctor', handleDoctor);
  bindActionForm('settings-form', 'settings', handleSettings);

  document.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
    element.addEventListener('click', (event) => {
      const action = element.dataset.action;
      if (action === 'close-modal' && event.target !== element && element.classList.contains('modal-backdrop')) {
        return;
      }
      if (action === 'close-modal') {
        modal = null;
        render();
      } else if (action === 'view-pet') {
        modal = 'viewer';
        message = '';
        render();
      } else if (action === 'view-own-pet') {
        viewedPubkey = '';
        modal = null;
        previewState = null;
        void load();
      } else if ((action === 'note' || action === 'pet-menu') && canWriteForCurrentPet()) {
        modal = 'note';
        render();
      } else if (action === 'doctor' && canWriteForCurrentPet()) {
        modal = 'doctor';
        doctorCandidates = [];
        doctorSource = null;
        doctorLoading = true;
        render();
        void loadDoctorCandidates();
      } else if (action === 'settings' && canWriteForCurrentPet()) {
        modal = 'settings';
        render();
      } else if (action === 'toggle-panel') {
        sidePanelHidden = !sidePanelHidden;
        console.log('[nappagochi:layout] care panel visibility changed', {
          hidden: sidePanelHidden,
        });
        void rememberSidePanelPreference();
        render();
      } else if (action === 'preview') {
        modal = 'preview';
        render();
      } else if (action === 'profile') {
        modal = 'profile';
        render();
      } else if (action === 'habitat-source') {
        modal = 'habitat-source';
        message = '';
        render();
        void openHabitatSource();
      } else if (action === 'habitat-source-open') {
        void openHabitatSource();
      } else if (action === 'clear-preview') {
        previewState = null;
        void rememberPreview(null);
        render();
      } else if (action === 'reload-doctor') {
        doctorCandidates = [];
        doctorSource = null;
        doctorLoading = true;
        render();
        void loadDoctorCandidates();
      } else if (action === 'adopt-next') {
        activeBirth = null;
        health = null;
        render();
      }
    });
  });

  document.querySelectorAll<HTMLElement>('[data-preview]').forEach((element) => {
    element.addEventListener('click', () => {
      const state = element.dataset.preview as PetState;
      if (!(state in STATE_META)) return;
      previewState = state;
      void rememberPreview(state);
      render();
    });
  });
}

function bindActionForm(
  formId: string,
  action: string,
  handler: (form: HTMLFormElement) => Promise<void>,
  submitOnEnter = false,
): void {
  const form = document.querySelector<HTMLFormElement>(`#${formId}`);
  const button = form?.querySelector<HTMLButtonElement>(`[data-submit="${action}"]`);
  if (!form || !button) return;

  button.addEventListener('click', () => {
    void handler(form);
  });

  if (submitOnEnter) {
    form.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (!button.disabled) void handler(form);
    });
  }
}

async function publishEvent(
  template: EventTemplate,
  options: OutboxPublishOptions = {},
  extraFallbackRelays: string[] = [],
): Promise<OutboxPublishResult> {
  if (!canWriteForCurrentPet()) {
    throw new Error('Viewing mode is read-only. Return to your own pet to publish.');
  }
  const explicitRelays = uniqueRelayUrls([
    ...fallbackRelayUrls,
    ...(options.relays ?? []),
    ...extraFallbackRelays,
  ]);
  return publishEventWithRouting(
    eventRouting,
    (currentTemplate, currentOptions) =>
      outbox.publish(currentTemplate, currentOptions),
    template,
    options,
    explicitRelays,
    relayPlanSource === 'nip65'
      ? true
      : relayPlanSource === 'fallback'
        ? false
        : undefined,
  );
}

async function handleView(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  try {
    const target = parseViewerNpub(String(data.get('npub') ?? ''));
    viewedPubkey = target === connectedPubkey ? '' : target;
    modal = null;
    previewState = null;
    await load();
  } catch (error) {
    message =
      error instanceof Error ? error.message : 'That npub could not be opened.';
    render();
  }
}

async function handleAdopt(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const name = String(data.get('name') ?? '').trim().slice(0, 28);
  const paletteValue = data.get('palette');
  const palette: Palette = isAllowedPalette(paletteValue) ? paletteValue : 'peach';
  if (!name) {
    message = 'Please give your pet a name.';
    render();
    return;
  }

  actionBusy = true;
  message = '';
  render();
  const previous = births.length
    ? [...births].sort((a, b) => b.event.created_at - a.event.created_at)[0]
    : undefined;
  const petData: PetData = {
    v: 1,
    name,
    species: 'momo',
    appearance: { ...DEFAULT_APPEARANCE, palette },
    ruleset: 'gentle-v1',
  };
  const tags = [
    ['d', BIRTH_D],
    ['t', 'nostr-pet'],
    ['alt', `Birth event for Nostr Pet ${name}`],
  ];
  if (previous) tags.push(['e', previous.event.id]);

  try {
    const result = await publishEvent({
      kind: 78,
      content: JSON.stringify(petData),
      tags,
      created_at: nowSeconds(),
    });
    if (!result.ok) throw new Error(result.error || 'The birth event was not accepted.');
    await load();
    message = `${name} has been born.`;
  } catch (error) {
    message = error instanceof Error ? error.message : 'The birth event could not be published.';
  } finally {
    actionBusy = false;
    render();
  }
}

async function handleNote(form: HTMLFormElement): Promise<void> {
  const content = String(new FormData(form).get('content') ?? '').trim();
  if (!content) {
    message = 'Write a note before publishing.';
    render();
    return;
  }

  actionBusy = true;
  render();
  try {
    const result = await publishEvent({
      kind: 1,
      content,
      tags: [],
      created_at: nowSeconds(),
    });
    const published = requireAcceptedPublishedEvent(result, {
      ownerPubkey: pubkey,
      kind: 1,
    });
    const fedPet = Boolean(health?.canFeed);
    notes = mergeEventHistory(notes, [published]);
    modal = null;
    // A top-level feed cannot add medicine, so keep the verified set from the
    // initial sync instead of repeating parent-note lookups for old replies.
    await refreshDerivedState(false);
    const relayCount = acceptedRelayCount(result);
    const localAccepted = Boolean(
      eventRouting.localRelayUrl &&
        result.relays?.[eventRouting.localRelayUrl],
    );
    const acceptance =
      eventRouting.localRelayOnly && localAccepted
        ? 'the local relay'
        : eventRouting.localRelayMirror && localAccepted
          ? `${relayCount} relay${relayCount === 1 ? '' : 's'}, including the local mirror`
          : eventRouting.localRelayMirror && relayCount
            ? `${relayCount} relay${relayCount === 1 ? '' : 's'}; the local mirror did not accept it`
        : relayCount
          ? `${relayCount} relay${relayCount === 1 ? '' : 's'}`
          : 'the shell’s relay plan';
    message = fedPet
      ? `Note signed and accepted by ${acceptance}. Pulse refreshed to ${health?.daysQuiet ?? 0} quiet days.`
      : `Note signed and accepted by ${acceptance}.`;
  } catch (error) {
    message = error instanceof Error ? error.message : 'The note could not be published.';
  } finally {
    actionBusy = false;
    render();
  }
}

function selectDoctorCandidates(
  results: RelayEventResult[],
  allowedAuthors?: Set<string>,
): DoctorCandidate[] {
  const earliest = nowSeconds() - DOCTOR_DISCOVERY_LOOKBACK;
  const latest = nowSeconds() + FUTURE_TOLERANCE;
  const uniqueAuthors = new Set<string>();
  return results
    .filter(
      ({ event }) =>
        event.kind === 1 &&
        event.pubkey !== pubkey &&
        event.created_at >= earliest &&
        event.created_at <= latest &&
        !hasReplyTag(event) &&
        event.content.trim().length > 0 &&
        (!allowedAuthors || allowedAuthors.has(event.pubkey)),
    )
    .sort((left, right) => right.event.created_at - left.event.created_at)
    .filter(({ event }) => {
      if (uniqueAuthors.has(event.pubkey)) return false;
      uniqueAuthors.add(event.pubkey);
      return true;
    })
    .slice(0, 6)
    .map((item) => ({
      event: item.event,
      relayHint: item.sidecar?.relayHints?.[0] ?? '',
    }));
}

async function loadDoctorCandidates(): Promise<void> {
  doctorSource = null;
  try {
    const follows = (eventRouting.localRelayOnly
      ? accountFollows
      : await identity.getFollows().catch(() => []))
      .filter((key) => key !== pubkey)
      .slice(0, 30);
    if (follows.length) {
      try {
        const result = await queryPetEvents(
          [
            {
              authors: follows,
              kinds: [1],
              since: nowSeconds() - DOCTOR_DISCOVERY_LOOKBACK,
              limit: 60,
            },
          ],
          {
            authors: follows,
            limit: 60,
            timeoutMs: 7_000,
          },
        );
        incompleteSync ||= Boolean(result.incomplete);
        const followedCandidates = selectDoctorCandidates(result.events, new Set(follows));
        if (followedCandidates.length) {
          doctorCandidates = followedCandidates;
          doctorSource = 'follows';
          return;
        }
      } catch {
        // Public discovery below keeps the doctor usable when follow routes are unavailable.
      }
    }

    const result = await queryPetEvents(
      [
        {
          kinds: [1],
          since: nowSeconds() - DOCTOR_DISCOVERY_LOOKBACK,
          limit: 80,
        },
      ],
      {
        limit: 80,
        timeoutMs: 7_000,
        ...(fallbackRelayUrls.length ? { relays: fallbackRelayUrls } : {}),
      },
    );
    incompleteSync ||= Boolean(result.incomplete);
    doctorCandidates = selectDoctorCandidates(result.events);
    doctorSource = doctorCandidates.length ? 'discovery' : null;
  } catch (error) {
    message = error instanceof Error ? error.message : 'Reply candidates could not be loaded.';
    doctorCandidates = [];
    doctorSource = null;
  } finally {
    doctorLoading = false;
    render();
  }
}

async function handleDoctor(form: HTMLFormElement): Promise<void> {
  const data = new FormData(form);
  const candidate = doctorCandidates[Number(data.get('candidate'))];
  const content = String(data.get('content') ?? '').trim();
  if (!candidate || !content) {
    message = candidate ? 'Add something thoughtful before publishing.' : 'Choose a note first.';
    render();
    return;
  }

  actionBusy = true;
  render();
  const relayHint = candidate.relayHint;
  try {
    const result = await publishEvent(
      {
        kind: 1,
        content,
        tags: [
          ['e', candidate.event.id, relayHint, 'reply', candidate.event.pubkey],
          ['p', candidate.event.pubkey, relayHint],
        ],
        created_at: nowSeconds(),
      },
      { toOutbox: true, toInboxes: [candidate.event.pubkey] },
      relayHint ? [relayHint] : [],
    );
    const published = requireAcceptedPublishedEvent(result, {
      ownerPubkey: pubkey,
      kind: 1,
    });
    notes = mergeEventHistory(notes, [published]);
    modal = null;
    await refreshDerivedState();
    message = 'Published. The verified medicine is working.';
  } catch (error) {
    message = error instanceof Error ? error.message : 'Your message could not be published.';
  } finally {
    actionBusy = false;
    render();
  }
}

async function handleSettings(form: HTMLFormElement): Promise<void> {
  if (!activeBirth || health?.state === 'dead') return;
  const data = new FormData(form);
  const paletteValue = data.get('palette');
  const eyesValue = data.get('eyes');
  const accessoryValue = data.get('accessory');
  const nextAppearance: Appearance = {
    base: 'momo-01',
    palette: isAllowedPalette(paletteValue) ? paletteValue : 'peach',
    eyes: isAllowedEyes(eyesValue) ? eyesValue : 'round',
    accessory: isAllowedAccessory(accessoryValue) ? accessoryValue : 'none',
  };

  actionBusy = true;
  render();
  try {
    const result = await publishEvent({
      kind: 30_078,
      content: JSON.stringify({ v: 1, name: activeBirth.data.name, appearance: nextAppearance }),
      tags: [
        ['d', profileD(activeBirth.event.id)],
        ['e', activeBirth.event.id],
        ['t', 'nostr-pet'],
        ['alt', `Appearance for Nostr Pet ${activeBirth.data.name}`],
      ],
      created_at: nowSeconds(),
    });
    if (!result.ok) throw new Error(result.error || 'The appearance event was not accepted.');
    appearance = nextAppearance;
    modal = null;
    message = 'Appearance saved to Nostr.';
  } catch (error) {
    message = error instanceof Error ? error.message : 'Appearance could not be saved.';
  } finally {
    actionBusy = false;
    render();
  }
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.style.setProperty('--shell-bg', theme.colors.background);
  root.style.setProperty('--shell-text', theme.colors.text);
  root.style.setProperty('--shell-primary', theme.colors.primary);
  root.style.background = theme.colors.background;
  root.style.color = theme.colors.text;
  document.body.style.background = theme.colors.background;
  document.body.style.color = theme.colors.text;
  app.style.background = theme.colors.background;
  app.style.color = theme.colors.text;
}

async function setupTheme(): Promise<void> {
  applyTheme(FALLBACK_THEME);
  try {
    applyTheme(await themeGet());
  } catch {
    applyTheme(FALLBACK_THEME);
    return;
  }
  try {
    themeSubscription = themeOnChanged(applyTheme);
  } catch {
    console.log('[nappagochi:degradation] live theme updates unavailable; current theme retained');
  }
}

function cleanUp(): void {
  liveSession?.destroy();
  liveSession = null;
  liveAggregator?.destroy();
  liveAggregator = null;
  liveStatusUnsubscribe?.();
  liveStatusUnsubscribe = null;
  resetLiveDegradation();
  emotionUnsubscribe?.();
  emotionUnsubscribe = null;
  emotionController.destroy();
  speechUnsubscribe?.();
  speechUnsubscribe = null;
  speechController.destroy();
  if (reactionFrame !== null) window.cancelAnimationFrame(reactionFrame);
  if (activityRefreshTimer !== null) window.clearTimeout(activityRefreshTimer);
  identitySubscription?.close();
  themeSubscription?.close();
  if (healthTimer !== null) window.clearInterval(healthTimer);
}

async function start(): Promise<void> {
  applyTheme(FALLBACK_THEME);
  render();
  if (!hasRequiredRuntime()) return;
  await setupTheme();
  await setupEventRouting();
  await restoreSidePanelPreference();
  liveSession = new LiveSessionManager({
    mountedAt: APP_MOUNTED_AT,
    openChannel: openLiveChannel,
  });
  liveSession.onDelivery(handleLiveDelivery);
  liveStatusUnsubscribe = liveSession.onStatus(handleLiveChannelStatus);
  liveAggregator = new LiveSignalAggregator({
    onAggregate: (aggregate) => {
      const reaction = reactionForLiveAggregate(aggregate);
      const accepted = emotionController.react(reaction);
      console.log('[nappagochi:emotion] live aggregate evaluated', {
        reaction,
        accepted,
        totalSignals: aggregate.total,
        actorCount: aggregate.actorCount,
        byType: aggregate.byType,
        authoritativeCondition: health?.state ?? null,
        previewActive: Boolean(previewState),
      });
      if (accepted) {
        animateCurrentReaction();
        const enrichmentGeneration = ++reactionEnrichmentGeneration;
        const zapSender = aggregate.representativeSignal.zap?.senderPubkey;
        void reactionMetadataLoader.enrichApprovedReaction({
          reactionAccepted: accepted,
          reactionId: reaction,
          actorPubkey: zapSender,
        }).then((actor) => {
          if (enrichmentGeneration !== reactionEnrichmentGeneration) {
            console.log('[nappagochi:enrichment] stale reaction metadata discarded', {
              reaction,
              enrichmentGeneration,
              activeGeneration: reactionEnrichmentGeneration,
            });
            return;
          }
          speechController.say(speechForLiveAggregate(aggregate, 'gentle', actor?.name));
        });
      }
    },
  });
  identitySubscription = identity.onChanged(() => {
    void load();
  });
  await load();
  healthTimer = window.setInterval(() => {
    if (!activeBirth) return;
    health = reduceHealth(activeBirth, nowSeconds());
    render();
  }, 60_000);
}

window.addEventListener('beforeunload', cleanUp);
void start();
