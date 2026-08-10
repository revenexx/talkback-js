import { nitroTokenHandler } from '@revenexx/talkback-js/server';
import { facade, playgroundUser } from '../../utils/talkback';

/**
 * `POST /bff/talkback-token` — the route ADR-0093 has listed since Phase 0 and which
 * existed nowhere until this package.
 */
export default defineEventHandler(
  nitroTokenHandler({
    facade: facade(),
    h3: { readBody, createError },

    // In a real application: `await getUserSession(event)`. See server/utils/talkback.ts.
    resolveUser: () => playgroundUser(),

    // REQUIRED, and its absence is a type error. A playground authorises everything the
    // client asks for, which is exactly what a real application must not do — the
    // channels are still parsed against the session's tenant before anything is minted,
    // so even this cannot cross a tenant boundary.
    authorizeChannels: ({ requested }) => [...requested],
  }),
);
