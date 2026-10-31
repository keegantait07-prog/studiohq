import { randomUUID } from 'crypto'

export interface ApprovalRequest { id: string; tool: string; summary: string }

interface Pending { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }

/** Holds write-tool requests until the user answers in the UI. Anything unanswered resolves false. */
export class Approvals {
  onRequest: (r: ApprovalRequest) => void = () => {}
  private pending = new Map<string, Pending>()

  constructor(private timeoutMs = 300000) {}

  request(tool: string, summary: string): Promise<boolean> {
    const id = randomUUID()
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.resolve(id, false), this.timeoutMs)
      this.pending.set(id, { resolve, timer })
      this.onRequest({ id, tool, summary })
    })
  }

  resolve(id: string, approved: boolean): void {
    const p = this.pending.get(id)
    if (!p) return
    this.pending.delete(id)
    clearTimeout(p.timer)
    p.resolve(approved)
  }

  rejectAll(): void {
    for (const id of [...this.pending.keys()]) this.resolve(id, false)
  }
}
