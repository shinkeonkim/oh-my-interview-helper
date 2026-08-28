export type HandlerRunResult =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed" }
  | { readonly kind: "aborted"; readonly reason: unknown }

export const runHandler = (
  handler: Promise<void>,
  signal: AbortSignal
): Promise<HandlerRunResult> =>
  new Promise((resolve) => {
    const abort = (): void => {
      if (signal.reason !== "shutdown") resolve({ kind: "aborted", reason: signal.reason })
    }
    if (signal.aborted) abort()
    else signal.addEventListener("abort", abort, { once: true })
    void handler.then(
      () => resolve({ kind: "succeeded" }),
      () => resolve({ kind: "failed" })
    )
  })
