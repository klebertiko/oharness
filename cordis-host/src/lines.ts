/** Splits a byte stream into lines without ever holding more than `limit` bytes of one line. */
export class LineSplitter {
  readonly #limit: number
  readonly #onLine: (line: string) => void
  readonly #onOverflow: 'cut' | (() => void)
  #parts: Buffer[] = []
  #size = 0
  #stopped = false

  /** `onOverflow` is 'cut' to pass a too-long line on in pieces, or a callback that ends reading. */
  constructor(limit: number, onLine: (line: string) => void, onOverflow: 'cut' | (() => void)) {
    this.#limit = limit
    this.#onLine = onLine
    this.#onOverflow = onOverflow
  }

  push(chunk: Buffer): void {
    let start = 0
    while (!this.#stopped) {
      const newline = chunk.indexOf(0x0a, start)
      const end = newline < 0 ? chunk.length : newline
      if (!this.#take(chunk.subarray(start, end))) return
      if (newline < 0) return
      this.#flush()
      start = newline + 1
    }
  }

  /** Buffer part of a line; false when reading stopped. */
  #take(part: Buffer): boolean {
    let rest = part
    while (this.#size + rest.length > this.#limit) {
      if (this.#onOverflow !== 'cut') {
        this.#stopped = true
        this.#parts = []
        this.#onOverflow()
        return false
      }
      const room = this.#limit - this.#size
      this.#parts.push(rest.subarray(0, room))
      this.#size += room
      this.#flush()
      rest = rest.subarray(room)
    }
    if (rest.length > 0) {
      this.#parts.push(rest)
      this.#size += rest.length
    }
    return true
  }

  #flush(): void {
    const line = Buffer.concat(this.#parts).toString('utf8')
    this.#parts = []
    this.#size = 0
    this.#onLine(line)
  }
}

// Terminal escape sequences: CSI (ESC [ ... final), OSC (ESC ] ... BEL or ESC \), and two-byte ESC forms.
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/gu
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/gu
const ESCAPE = /\u001b[@-_]?/gu
// Every other C0 and C1 control character, DEL included, and the bidi marks,
// embeddings, overrides and isolates that reorder what a terminal shows. Tab stays.
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/gu

/** One line of plugin output as plain text: no escape sequences, control characters or bidi controls. */
export function outputLine(line: string): string {
  return line.replace(OSC, '').replace(CSI, '').replace(ESCAPE, '').replace(CONTROL, '')
}
