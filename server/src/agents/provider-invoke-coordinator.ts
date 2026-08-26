export class ProviderInvokeCoordinator<Terminal> {
  private readonly pending = new Map<string, Terminal | null>()

  register(jobId: string): void {
    this.pending.set(jobId, null)
  }
  report(jobId: string, terminal: Terminal): void {
    if (this.pending.has(jobId)) this.pending.set(jobId, terminal)
  }
  take(jobId: string): Terminal | undefined {
    const terminal = this.pending.get(jobId)
    this.pending.delete(jobId)
    return terminal ?? undefined
  }
  get size(): number {
    return this.pending.size
  }
}
