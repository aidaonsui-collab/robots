/**
 * Static per-token overrides — for metadata that isn't stored on-chain
 * or isn't available from the backend.
 *
 * Key: pool object ID (0x...)
 */
export const TOKEN_CONFIG: Record<string, { streamUrl?: string }> = {
  // HOPE
  '0x3ada016f66446b16361ec4a9b8f7a9ab8679bd945d9959d3e357619c44ea15d5': {
    streamUrl: 'https://www.youtube.com/watch?v=dXIyMS61B68',
  },
  // ZEUS
  '0xd22d8d7c323e1f2a15b225791a4944196d7420b1f3d2007ab6971fd4463432f3': {
    streamUrl: 'https://youtu.be/XVEjtloKlpM?si=Bl-NK0-aCkxuPkTX',
  },
}
