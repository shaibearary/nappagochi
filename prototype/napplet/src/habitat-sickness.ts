import type { ActivityState } from './activity-reconciliation.ts';

export const HABITAT_SICK_AFTER_DAYS = 14;

type HabitatSicknessInput = {
  incomplete: boolean;
  birthCreatedAt: number;
  lastHabitatChangeAt?: number;
  lastMedicineAt?: number;
  at: number;
  daySeconds?: number;
};

export type HabitatSickness = {
  sick: boolean;
  riskSince: number;
  daysIncomplete: number;
  daysUntilSick: number;
};

function timestampAtOrBefore(value: number | undefined, at: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value <= at
    ? value
    : 0;
}

export function reduceHabitatSickness(
  input: HabitatSicknessInput,
): HabitatSickness {
  const daySeconds = input.daySeconds ?? 86_400;
  const graceSeconds = HABITAT_SICK_AFTER_DAYS * daySeconds;
  const riskSince = Math.max(
    timestampAtOrBefore(input.birthCreatedAt, input.at),
    timestampAtOrBefore(input.lastHabitatChangeAt, input.at),
    timestampAtOrBefore(input.lastMedicineAt, input.at),
  );
  const elapsed = Math.max(0, input.at - riskSince);
  const daysIncomplete = input.incomplete
    ? Math.floor(elapsed / daySeconds)
    : 0;

  return {
    sick: input.incomplete && elapsed >= graceSeconds,
    riskSince,
    daysIncomplete,
    daysUntilSick: input.incomplete
      ? Math.max(0, HABITAT_SICK_AFTER_DAYS - daysIncomplete)
      : HABITAT_SICK_AFTER_DAYS,
  };
}

export function applyHabitatSickness(
  activityState: ActivityState,
  habitatSick: boolean,
): ActivityState {
  if (
    habitatSick &&
    (activityState === 'happy' ||
      activityState === 'content' ||
      activityState === 'lonely')
  ) {
    return 'sick';
  }
  return activityState;
}
