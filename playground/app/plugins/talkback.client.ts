import { createTalkback } from '@revenexx/talkback-js';
import { provideTalkback } from '@revenexx/talkback-js/vue';

/**
 * One client per application. A second `createTalkback` would open a second WebSocket
 * and mint its own connection token, which is why this is a plugin rather than a
 * composable that builds one on demand.
 *
 * `.client.ts`: there is nothing for it to do during server rendering.
 */
export default defineNuxtPlugin(nuxtApp => {
  const config = useRuntimeConfig();

  const tb = createTalkback({
    host: config.public.centrifugoUrl as string,
    // PROVIDERS, not values — the active tenant changes at run time in a real app.
    tenant: () => config.public.tenant as string,
    userId: () => config.public.userId as string,
    tokenEndpoint: '/bff/talkback-token',
    subscriptionTokenEndpoint: '/bff/talkback-subscription-token',
  });
  tb.connect();

  nuxtApp.vueApp.runWithContext(() => provideTalkback(tb));
  return { provide: { talkback: tb } };
});
