export type HealthStatus = {
  readonly status: "ok"
}

export const HEALTH_STATUS = { status: "ok" } as const satisfies HealthStatus
