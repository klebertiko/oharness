/** Each provider's setup guide lives in the repo, under docs/guides/providers/. */
const GUIDES = "https://github.com/klebertiko/oharness/blob/main/docs/guides/providers";

export function setupGuideUrl(provider: string): string {
  return `${GUIDES}/${encodeURIComponent(provider)}.md`;
}
