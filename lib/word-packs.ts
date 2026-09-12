// Server-side release switch. Both deployment processes must use the same value.
export function wordPacksEnabled() {
  return process.env.ENABLE_WORD_PACKS === 'true'
}
