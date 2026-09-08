// Node/Railway fallback for modules that optionally read Cloudflare bindings.
// The persistent Node environment supplies DB and document storage instead.
export const env: Record<string, unknown> = {};
