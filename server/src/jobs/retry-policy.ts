export const retryAt = (now: string, attemptCount: number): string => {
  const delay = Math.min(60_000, 1_000 * 2 ** Math.max(0, attemptCount - 1))
  return new Date(new Date(now).getTime() + delay).toISOString()
}
