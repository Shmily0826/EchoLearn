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

## Localhost E2E

Normal localhost E2E runs against the local Vite server and does not require
the Production dogfood URL. Tests that exercise analytics suppression should
install the session marker before navigation or use the dogfood query locally.

## Contract boundary

This visitor-analytics contract covers Vercel Web Analytics and Firebase /
Google Analytics collection. Sentry is separate and explicitly excluded.
