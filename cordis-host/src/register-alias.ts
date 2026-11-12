/**
 * One Cordis module instance for the host and for plugins.
 *
 * DSH plugins import `@deepseek-ai/cordis` because DSH rescopes the package.
 * Installing that name from the registry would pull `@deepseek-ai/cordis`
 * 4.1.0, which is not the rc.11 tarball. The hook below resolves the
 * specifier to npm `cordis`, the pinned rc.11 copy.
 *
 * `@deepseek-ai/dsh-tools` resolves to the subset in dsh-tools-subset.ts.
 * That module is not the DSH tools package: it does not validate arguments
 * and it does not run the DSH tool pipeline.
 *
 * `@deepseek-ai/schemastery` resolves to npm `schemastery@3.18.0`. See pin.ts
 * for why that commit is not DSH's vendored Schemastery.
 */
import { registerHooks } from 'node:module'

const subsetUrl = new URL('./dsh-tools-subset.ts', import.meta.url).href

function remap(specifier: string, from: string, to: string): string | undefined {
  if (specifier === from) return to
  const prefix = `${from}/`
  if (specifier.startsWith(prefix)) return to + specifier.slice(from.length)
  return undefined
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const cordis = remap(specifier, '@deepseek-ai/cordis', 'cordis')
    if (cordis !== undefined) return nextResolve(cordis, context)
    const schema = remap(specifier, '@deepseek-ai/schemastery', 'schemastery')
    if (schema !== undefined) return nextResolve(schema, context)
    if (specifier === '@deepseek-ai/dsh-tools') {
      return { url: subsetUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
