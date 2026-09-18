# EchoLearn Testing

## Deployed-host browser validation

All developer, AI, and automation browser validation against a deployed
EchoLearn host defaults to analytics suppression.

The canonical Production test entry is:

`https://echo-learn.uk/?dogfood=1`

The app consumes `dogfood=1` before render, stores the session-only marker
`sessionStorage['echolearn_test_traffic'] = '1'`, and removes only that query
parameter. An equivalent pre-app `sessionStorage` marker is also valid for
automation.

Preview and Staging hosts that share Production analytics must use the same
suppression rule before browser validation.

Dogfood is ANALYTICS-SAFE ONLY. It suppresses Vercel Web Analytics and Firebase
Analytics custom events for the marked session. It does not authorize:

- Production Firebase, Auth, or Firestore mutation;
- product API traffic or changes to user/product data;
- paid-provider traffic, AI-provider traffic, or ASR requests.

Those activities require a separate explicit safety scope and must not be
assumed safe because the analytics marker is present.

## Verifying a deployment and its behaviour

`npm run ai:seek-smoke` (`scripts/ai-seek-smoke.mjs`) answers two questions that
CI cannot — *is the deployed build the one that contains this change*, and *does
it behave as that change intends* — and it is the pattern to copy for other
behaviour-level checks.

- It signs in on `?dogfood=1`, so the analytics rule above still applies, and the
  paid-provider rule below still applies: the marker does not authorise provider
  traffic.
- It reads the labels the live page actually rendered and compares them against
  an offline re-alignment computed by the app's own matcher. Only suggestions
  where the **raw caption blocks** and the **rendered sentence lines** disagree
  can decide the verdict; a run containing none reports INCONCLUSIVE, never PASS.
- **Do not try to prove a deployment by comparing the local build with the live
  one.** The local build has no `VITE_SENTRY_DSN`, so Sentry is tree-shaken out
  and the entry chunk is ~85 KB smaller; framework chunks can match byte-for-byte
  while every application chunk hash differs.
- Paid provider: the page's `/api/ai` request is gated through
  `scripts/paid-provider-guard.mjs`. With the policy **unset the request is
  aborted**, so a run can only succeed from a cache HIT and cannot spend. One
  real call requires
  `ECHOLEARN_ALLOW_PAID_PROVIDER=1 ECHOLEARN_PAID_MAX_INVOCATIONS=1`.
- Exit codes: `0` PASS, `1` FAIL, `2` blocked/config error, `3` INCONCLUSIVE.

## Localhost E2E

Normal localhost E2E runs against the local Vite server and does not require
the Production dogfood URL. Tests that exercise analytics suppression should
install the session marker before navigation or use the dogfood query locally.

## Contract boundary

This visitor-analytics contract covers Vercel Web Analytics and Firebase /
Google Analytics collection. Sentry is separate and explicitly excluded.
