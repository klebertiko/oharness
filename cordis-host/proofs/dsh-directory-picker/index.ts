import type { Context } from '@deepseek-ai/cordis'
import {
  DirectoryPicker,
  DirectoryPickerError,
  type DirectoryPickerCapability,
} from '@oharness/dsh-directory-picker'

const mark = globalThis as typeof globalThis & { oharnessDirectoryPickerProofEvaluated?: number }
mark.oharnessDirectoryPickerProofEvaluated = (mark.oharnessDirectoryPickerProofEvaluated ?? 0) + 1

/** Loads the DSH DirectoryPicker service. The upstream class is abstract, so the capability method is filled here. */
export default class ProofDirectoryPicker extends DirectoryPicker {
  constructor(ctx: Context) {
    super(ctx)
  }

  capability(): DirectoryPickerCapability {
    return {
      kind: 'native',
      pick(_signal: AbortSignal) {
        return Promise.resolve(null)
      },
    }
  }

  refuse(target: string): never {
    throw new DirectoryPickerError('directory-unreadable', target, 'not listed')
  }
}
