export class HostError extends Error {
  readonly code: string
  readonly preview?: unknown

  /**
   * @param code Stable machine code. HTTP status is chosen from this, not from the message.
   * @param message Short text safe to return to the local caller. No stack and no token.
   * @param preview Install preview attached to confirmation failures.
   */
  constructor(code: string, message: string, preview?: unknown) {
    super(message)
    this.name = 'HostError'
    this.code = code
    this.preview = preview
  }
}
