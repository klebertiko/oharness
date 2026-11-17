/**
 * Type-only name for the runtime hook in register-alias.ts.
 * The hook loads npm `cordis`. This declaration tells the checker the same thing.
 */
declare module '@deepseek-ai/cordis' {
  export * from 'cordis'
}

declare module '@deepseek-ai/schemastery' {
  import schemastery from 'schemastery'
  export default schemastery
}
