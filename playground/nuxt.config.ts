export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  // The client is browser-only; rendering it on the server would open a WebSocket per
  // request. The composables respect import.meta.client, but a playground has no reason
  // to prove that the hard way.
  ssr: false,
  runtimeConfig: {
    // Server-only. The facade is reachable from the host on 8880 in `make dev`.
    talkbackUrl: process.env.TALKBACK_URL || 'http://localhost:8880',
    talkbackTenant: process.env.TALKBACK_TENANT || 'acme-eu',
    zitadelIssuer: process.env.ZITADEL_ISSUER || 'http://localhost:8083',
    talkbackClientId: process.env.TALKBACK_ZITADEL_CLIENT_ID || 'talkback-dev',
    talkbackClientSecret: process.env.TALKBACK_ZITADEL_CLIENT_SECRET || 'dev-secret',
    public: {
      centrifugoUrl: process.env.CENTRIFUGO_URL || 'http://localhost:8000',
      tenant: process.env.TALKBACK_TENANT || 'acme-eu',
      userId: 'u1',
    },
  },
})
