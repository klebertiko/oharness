# Vendored DeepSeek Harness plugin sources

These files are copied from [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) at commit `e8f7b93a344964de3dca1ace9e72b6e4d6de87cb` (MIT). `PIN.json` records each git blob SHA. The bytes of `index.ts`, `types.ts`, and `LICENSE` are the upstream bytes.

Cordis itself is not in this directory. The host depends on the npm package `cordis@4.0.0-rc.11`, whose registry `gitHead` is `0b96d9fd517b998e44e2209560c9e5f0671ce933`, the same commit DSH lists in `vendor/README.md`. The local modifications V1–V27 in that README are not applied. The published package `@deepseek-ai/cordis` (4.1.0 at the time of this pin) is not installed.

`@deepseek-ai/cordis` imports in these plugins resolve to that npm package through a loader hook, so the plugin and the host share one Cordis module instance.
