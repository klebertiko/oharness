/**
 * Pins for the Cordis copy this host runs.
 *
 * DSH's vendor/README.md records cordis 4.0.0-rc.11 at commit
 * 0b96d9fd517b998e44e2209560c9e5f0671ce933. `npm view cordis@4.0.0-rc.11`
 * reports that same gitHead. The integrity below is the registry tarball
 * hash and must match cordis-host/package-lock.json.
 *
 * Not pinned, and not installed: `@deepseek-ai/cordis@4.1.0` (the rescoped
 * package) and DSH's local Cordis modifications V1–V27.
 *
 * Schemastery is different. DSH vendors commit cf0b7e54 and calls it 3.18.0.
 * The npm tarball 3.18.0 is gitHead 9e1f54f8 ("feat: support standard schema").
 * tool-todo's config schema needs a Schemastery that implements Standard
 * Schema, which upstream Cordis 4.0.0-rc.11 validates with. We use the npm
 * tarball and record that it is not DSH's vendored tree.
 */

export const CORDIS_PACKAGE = 'cordis'
export const CORDIS_VERSION = '4.0.0-rc.11'
export const CORDIS_INTEGRITY =
  'sha512-03PHbcYJzp84XRKnW7jd17g26bPvG5UvSyhyjxGIu/1VQs3bweNMACo3t1W0ikzoZ7q+wytHyk8jJsaIQOkPkA=='
export const CORDIS_GIT_HEAD = '0b96d9fd517b998e44e2209560c9e5f0671ce933'
export const CORDIS_DSH_VENDOR_COMMIT = CORDIS_GIT_HEAD
export const CORDIS_RESCOPED_VERSION_NOT_USED = '4.1.0'

export const SCHEMASTERY_PACKAGE = 'schemastery'
export const SCHEMASTERY_VERSION = '3.18.0'
export const SCHEMASTERY_INTEGRITY =
  'sha512-Jw2uxjoyyqc/yeurmChUEc/jbi8GsrdXV/KmqRUDZXJAXAmrJiPsz8vKa17l/VckyzljHZ9oGaul443CQiXxtA=='
export const SCHEMASTERY_NPM_GIT_HEAD = '9e1f54f8ff785a4e51a022922999634205b61e1f'
export const SCHEMASTERY_DSH_VENDOR_COMMIT = 'cf0b7e5481d0e31d10cdc30bc45c09366c332f27'

export const ZOD_PACKAGE = 'zod'
export const ZOD_VERSION = '4.6.6'
export const ZOD_INTEGRITY =
  'sha512-4UmzQUF5fxvfcYHlbjBmejU+w+hbDnWFx4aS8kBx7nPBHcO2SqPbpAG8snbdg+Xse4pRefR98hgjFgIMCI/UhA=='

export const DSH_PLUGIN_COMMIT = 'e8f7b93a344964de3dca1ace9e72b6e4d6de87cb'
