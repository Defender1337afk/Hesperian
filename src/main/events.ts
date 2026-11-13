import { randomUUID } from 'node:crypto'
import type { TaskState } from '../shared/types'

type Sink = (channel: string, payload: unknown) => void
let sink: Sink = () => {}

export const setEventSink = (next: Sink): void => {
  sink = next
}
export const emit = (channel: string, payload: unknown): void => sink(channel, payload)

const THROTTLE_MS = 80

export class Task {
  private state: TaskState
  private lastEmit = 0

  constructor(title: string) {
    this.state = { id: randomUUID(), title, detail: '', done: 0, total: 0, state: 'running' }
    this.flush()
  }

  stage(detail: string, total = 0): void {
    Object.assign(this.state, { detail, done: 0, total })
    this.flush()
  }

  progress(done: number, total = this.state.total): void {
    this.state.done = done
    this.state.total = total
    if (Date.now() - this.lastEmit > THROTTLE_MS) this.flush()
  }

  finish(): void {
    this.state.state = 'done'
    this.flush()
  }

  fail(error: unknown): void {
    this.state.state = 'error'
    this.state.error = error instanceof Error ? error.message : String(error)
    this.flush()
  }

  private flush(): void {
    this.lastEmit = Date.now()
    emit('task', { ...this.state })
  }
}
