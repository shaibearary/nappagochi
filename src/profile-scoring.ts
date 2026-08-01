export type ProfileTier = 'excellent' | 'healthy' | 'attention' | 'incomplete';

export function scoreProfileChecks(
  checks: readonly { point: boolean; assessed?: boolean }[],
): { score: number; max: number; tier: ProfileTier } {
  const assessed = checks.filter((check) => check.assessed !== false);
  const score = assessed.filter((check) => check.point).length;
  const max = assessed.length;
  const ratio = max > 0 ? score / max : 0;
  const tier = ratio === 1
    ? 'excellent'
    : ratio >= 0.75
      ? 'healthy'
      : ratio >= 0.5
        ? 'attention'
        : 'incomplete';
  return { score, max, tier };
}
