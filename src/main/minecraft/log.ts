import type { LogLine } from '../../shared/types'

const EVENT_START = /<log4j:Event logger="([^"]*)" timestamp="(\d+)" level="(\w+)" thread="([^"]*)">/
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/
const PLAIN_LEVEL = /\/(INFO|WARN|ERROR|DEBUG|FATAL|TRACE)\]/

const toLevel = (raw: string | undefined): LogLine['level'] => {
  switch (raw) {
    case 'WARN':
      return 'warn'
    case 'ERROR':
    case 'FATAL':
      return 'error'
    case 'DEBUG':
    case 'TRACE':
      return 'debug'
    default:
      return 'info'
  }
}

export class LogParser {
  private tail = ''
  private event: { head: RegExpExecArray; body: string } | null = null

  feed(chunk: string, emit: (text: string, level: LogLine['level']) => void): void {
    const lines = (this.tail + chunk).split(/\r?\n/)
    this.tail = lines.pop() ?? ''
    for (const line of lines) this.line(line, emit)
  }

  flush(emit: (text: string, level: LogLine['level']) => void): void {
    if (this.tail) this.line(this.tail, emit)
    this.tail = ''
  }

  private line(line: string, emit: (text: string, level: LogLine['level']) => void): void {
    if (this.event) {
      this.event.body += `${line}\n`
      if (!line.includes('</log4j:Event>')) return
      const { head, body } = this.event
      this.event = null
      const [, logger, timestamp, level, thread] = head
      const message = CDATA.exec(body)?.[1]?.trimEnd() ?? ''
      const time = new Date(Number(timestamp)).toLocaleTimeString('ru-RU')
      const short = logger.split('.').pop()
      emit(`[${time}] [${thread}/${level}] [${short}]: ${message}`, toLevel(level))
      const thrown = /<log4j:Throwable>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/log4j:Throwable>/.exec(body)?.[1]
      if (thrown) emit(thrown.trimEnd(), 'error')
      return
    }
    const head = EVENT_START.exec(line)
    if (head) {
      this.event = { head, body: '' }
      this.line(line, emit)
      return
    }
    if (line.trim()) emit(line, toLevel(PLAIN_LEVEL.exec(line)?.[1]))
  }
}
