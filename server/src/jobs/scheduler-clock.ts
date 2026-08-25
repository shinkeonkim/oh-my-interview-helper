export type SchedulerTimer = { readonly cancel: () => void }

export type SchedulerClock = {
  readonly now: () => Date
  readonly setTimeout: (callback: () => void, milliseconds: number) => SchedulerTimer
}

export const systemSchedulerClock: SchedulerClock = {
  now: () => new Date(),
  setTimeout: (callback, milliseconds) => {
    const handle = setTimeout(callback, milliseconds)
    return { cancel: () => clearTimeout(handle) }
  }
}
