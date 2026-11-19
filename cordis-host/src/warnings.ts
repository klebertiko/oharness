import { createHash, timingSafeEqual } from 'node:crypto'

/** Bump when the warning text changes so old confirmations stop matching. */
export const WARNING_VERSION = 2

/**
 * Carries the DSH safety limit and the boundary this host does enforce: an
 * isolated plugin runs in its own Node process under the permission model,
 * and each confirmed capability lifts one limit. Network is never limited.
 */
export const WARNING_EN =
  "A third-party Cordis plugin runs in its own process. Unless you confirm a capability, that process can read only the plugin's own files and this host's pinned modules, cannot write files, cannot start processes, and gets none of your environment variables. Each capability you confirm lifts one limit: files (read and write any file you can reach), processes (start programs, which run outside these limits), credentials (your environment variables). The network is not limited: the plugin can use it. A plugin declared in-process runs inside the host with all of these at once. Sandbox and approval protect the agent's actions. Beyond these limits, they do not protect you from the plugin's own code. Install a plugin only after you have reviewed it and confirmed this warning."

export const WARNING_PT =
  'Um Cordis plugin de terceiros roda num processo próprio. Sem uma capacidade confirmada, esse processo só lê os arquivos do próprio plugin e os módulos fixados deste host, não escreve arquivos, não inicia processos e não recebe suas variáveis de ambiente. Cada capacidade que você confirma tira um limite: files (ler e escrever qualquer arquivo que você alcança), processes (iniciar programas, que rodam fora desses limites), credentials (suas variáveis de ambiente, onde ficam credenciais). A rede não é limitada: o plugin pode usá-la. Um plugin declarado in-process roda dentro do host com tudo isso de uma vez. O sandbox e a aprovação protegem as ações do agente. Fora desses limites, eles não protegem você do código do próprio plugin. Instale um plugin só depois de revisá-lo e de confirmar este aviso.'

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
  /** Entry file, relative to the package directory, with `/` separators. */
  readonly entry: string
  /** sha256 over every file in the package directory (see `treeDigest`). */
  readonly tree: string
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
    input.entry,
    input.tree,
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
