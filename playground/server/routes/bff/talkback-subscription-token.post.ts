import { nitroSubscriptionTokenHandler } from '@revenexx/talkback-js/server';
import { facade, playgroundUser } from '../../utils/talkback';

/**
 * The dynamic path: one channel per request, for depth the client discovers at run time.
 */
export default defineEventHandler(
  nitroSubscriptionTokenHandler({
    facade: facade(),
    h3: { readBody, createError },
    resolveUser: () => playgroundUser(),
    authorizeChannel: () => true,
  }),
);
