import type { PetReaction } from './pet-emotion';

export type PetToneCue = {
  delayMs: number;
  durationMs: number;
  startHz: number;
  endHz: number;
  gain: number;
  wave: OscillatorType;
};

type SoundLogger = (message: string, details?: Record<string, unknown>) => void;

const REACTION_CUES: Readonly<Partial<Record<PetReaction, readonly PetToneCue[]>>> = {
  celebrate: [
    { delayMs: 70, durationMs: 220, startHz: 210, endHz: 610, gain: 0.045, wave: 'triangle' },
    { delayMs: 760, durationMs: 150, startHz: 125, endHz: 62, gain: 0.075, wave: 'sine' },
    { delayMs: 825, durationMs: 90, startHz: 520, endHz: 760, gain: 0.025, wave: 'sine' },
  ],
  'reply-roll': [
    { delayMs: 50, durationMs: 480, startHz: 240, endHz: 760, gain: 0.045, wave: 'sine' },
    { delayMs: 560, durationMs: 410, startHz: 760, endHz: 330, gain: 0.04, wave: 'sine' },
    { delayMs: 1_440, durationMs: 160, startHz: 130, endHz: 58, gain: 0.075, wave: 'triangle' },
  ],
  'zap-celebrate': [
    { delayMs: 20, durationMs: 310, startHz: 150, endHz: 300, gain: 0.04, wave: 'triangle' },
    { delayMs: 340, durationMs: 310, startHz: 210, endHz: 420, gain: 0.045, wave: 'triangle' },
    { delayMs: 710, durationMs: 1_120, startHz: 290, endHz: 690, gain: 0.04, wave: 'sine' },
    { delayMs: 1_900, durationMs: 260, startHz: 690, endHz: 920, gain: 0.035, wave: 'sine' },
  ],
};

export function soundCuesForReaction(reaction: PetReaction): readonly PetToneCue[] {
  return REACTION_CUES[reaction] ?? [];
}

export function soundEnabledFromStoredPreference(
  storedPreference: string | null | undefined,
): boolean {
  return storedPreference !== 'disabled';
}

export class PetSoundController {
  private enabled = false;
  private context: AudioContext | null = null;
  private readonly createContext: () => AudioContext | null;
  private readonly log: SoundLogger;

  constructor(options?: {
    createContext?: () => AudioContext | null;
    logger?: SoundLogger;
  }) {
    this.createContext = options?.createContext ?? (() => {
      const AudioContextClass = globalThis.AudioContext;
      return typeof AudioContextClass === 'function' ? new AudioContextClass() : null;
    });
    this.log = options?.logger ?? ((message, details) => console.log(message, details ?? {}));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean, options?: { unlock?: boolean }): void {
    this.enabled = enabled;
    this.log('[nappagochi:sound] preference changed', { enabled });
    if (enabled) {
      // Calling resume from the toggle click satisfies browser audio-gesture policy.
      if (options?.unlock !== false) void this.unlock();
      return;
    }
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close();
  }

  async unlock(): Promise<boolean> {
    if (!this.enabled) return false;
    this.context ??= this.createContext();
    if (!this.context) {
      this.log('[nappagochi:sound] Web Audio unavailable');
      return false;
    }
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        this.log('[nappagochi:sound] audio unlock deferred until another gesture');
        return false;
      }
    }
    return this.context.state === 'running';
  }

  async play(reaction: PetReaction): Promise<boolean> {
    const cues = soundCuesForReaction(reaction);
    if (!this.enabled || !cues.length) return false;
    this.context ??= this.createContext();
    if (!this.context) {
      this.log('[nappagochi:sound] Web Audio unavailable');
      return false;
    }
    if (this.context.state !== 'running') {
      // Browser autoplay policy may keep resume() pending until a gesture. Do
      // not let that make an old reaction play late; unlock only for the next
      // reaction and keep this one silent.
      this.log('[nappagochi:sound] reaction sound skipped; audio not ready', {
        reaction,
        contextState: this.context.state,
      });
      void this.unlock();
      return false;
    }
    for (const cue of cues) this.scheduleTone(this.context, cue);
    this.log('[nappagochi:sound] reaction sound scheduled', {
      reaction,
      cueCount: cues.length,
    });
    return true;
  }

  destroy(): void {
    this.enabled = false;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') void context.close();
  }

  private scheduleTone(context: AudioContext, cue: PetToneCue): void {
    const startsAt = context.currentTime + cue.delayMs / 1_000;
    const endsAt = startsAt + cue.durationMs / 1_000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = cue.wave;
    oscillator.frequency.setValueAtTime(cue.startHz, startsAt);
    oscillator.frequency.exponentialRampToValueAtTime(cue.endHz, endsAt);
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(cue.gain, startsAt + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(startsAt);
    oscillator.stop(endsAt + 0.03);
  }
}
