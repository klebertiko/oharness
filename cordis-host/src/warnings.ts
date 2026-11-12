import { createHash, timingSafeEqual } from 'node:crypto'

/** Bump when the warning text changes so old confirmations stop matching. */
export const WARNING_VERSION = 1

/**
 * Carries the DSH safety limit: a third-party plugin runs with the host
 * process's own reach, and sandbox or approval of the agent's actions does
 * not contain the plugin's code.
 */
export const WARNING_EN =
  'A third-party Cordis plugin runs inside this host process. It can read and write files, use the network, start processes, and read credentials this process can reach. Sandbox and approval protect the agent\'s actions. They do not protect you from the plugin\'s own code. The capability list is a declaration you confirm. It is not a sandbox. Install a plugin only after you have reviewed it and confirmed this warning.'

export const WARNING_PT =
  'Um Cordis plugin de terceiros roda dentro deste processo do host. Ele pode ler e escrever arquivos, usar a rede, iniciar processos e ler credenciais que este processo alcança. O sandbox e a aprovação protegem as ações do agente. Eles não protegem você do código do próprio plugin. A lista de capacidades é uma declaração que você confirma. Ela não é um sandbox. Instale um plugin só depois de revisá-lo e de confirmar este aviso.'

export interface WarningText {
  readonly en: string
  readonly 'pt-BR': string
}

export function warningText(): WarningText {
  return { en: WARNING_EN, 'pt-BR': WARNING_PT }
}

export interface DigestInput {
  readonly name: string
  readonly version: string
  readonly realpath: string
  readonly runtime: string
  readonly capabilities: readonly string[]
  readonly scripts: readonly string[]
}

/** Digest of the warning plus the exact package the human is confirming. */
export function installDigest(input: DigestInput): string {
  const lines = [
    String(WARNING_VERSION),
    input.name,
    input.version,
    input.realpath,
    input.runtime,
    [...input.capabilities].sort().join(','),
    [...input.scripts].sort().join(','),
    WARNING_EN,
    WARNING_PT,
  ]
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/** Compare digests without leaking which characters differ through timing. */
export function digestEqual(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}
