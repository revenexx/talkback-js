# Playground

A minimal Nuxt application that runs `@revenexx/talkback-js` against the local stack —
one BFF route and one page, which is the smallest thing that exercises both halves.

The stack itself (Valkey, Centrifugo, NATS, facade, bridge, devstub) lives in
`revenexx/talkback`, a separate, private repository:

```sh
cd /path/to/talkback && make dev
cd .. && npm run build
cd playground && npm install && npm run dev
```

Then publish into the stream channel the page is watching:

```sh
curl -s localhost:8880/v1/publish \
  -H "authorization: Bearer $(hack/token.sh)" \
  -H 'x-revenexx-tenant: acme-eu' \
  -H 'content-type: application/json' \
  -d '{"channel":"stream:acme-eu.demo","data":{"line":"hello"}}'
```

`private: true` and not in `files`, so it is never published. It exists so the two things
that cannot be unit-tested — a real Nitro handler and a real subscription over a real
transport — can be seen working.
