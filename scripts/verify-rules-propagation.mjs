/**
 * Read-only probe of the LIVE Production rules (ECHO_AUTH_DATA_AND_AI_CACHE_RELEASE_V1 §3, Stage 2).
 *
 * `firebase deploy` reporting success is not proof that the rules are
 * effective — Firestore keeps serving cached rules to active listeners for up
 * to ~10 minutes, and this project cannot list its rulesets over the REST API
 * (both `firebasemgmt.googleapis.com` rule endpoints answer 404), so the only
 * available confirmation is behavior. This script performs GETs exclusively:
 * it cannot create, update or delete a single document.
 *
 * What each answer means:
 *   403  -> a rule denied the read
 *   404  -> the rules let the read through and the probe document is absent
 *
 * The Stage-1 signal is `aiCache/...`: that path does not exist in the
 * pre-campaign rules, so a verified token gets 403 there and 404 once Stage 1
 * is live. Without a token every probe path is denied by design, which is also
 * the safety check: an authenticated-free 200/404 on `users/...` would mean
 * learner data had become public.
 *
 * Usage:
 *   node scripts/verify-rules-propagation.mjs
 *   ECHOLEARN_PROBE_TOKEN=<id token of a disposable verified account> \
 *     node scripts/verify-rules-propagation.mjs
 *
 * Exit codes: 0 = Stage 1 confirmed (token required), 1 = rules not yet
 * effective or an exposure was detected, 2 = network/usage error.
 */
const PROJECT = process.env.ECHOLEARN_PROJECT_ID || 'echolearn-9f369';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const STAMP = Date.now();
const PROBE_UID = `probe-unauthenticated-${STAMP}`;

const token = process.env.ECHOLEARN_PROBE_TOKEN || null;

/** Paths probed without any credential. `deny` marks ones no rule may open. */
const ANONYMOUS_PROBES = [
  { label: 'user data', path: `users/${PROBE_UID}/data/vocabulary`, deny: true },
  { label: 'legacy shared cache read', path: `aiAnalyses/probe-absent-${STAMP}`, deny: false },
  { label: 'private cache subtree', path: `aiCache/${PROBE_UID}/analyses/probe-absent-${STAMP}`, deny: true },
  { label: 'legacy flat feedback read', path: `feedback/probe-absent-${STAMP}`, deny: true },
];

async function probe(path, bearer) {
  const res = await fetch(`${BASE}/${path}`, {
    method: 'GET',
    headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
  });
  return res.status;
}

function verdict(status, { deny, label }) {
  if (status === 403) return deny ? `OK denied        ${label}` : `denied           ${label}`;
  if (status === 404) return deny ? `!! EXPOSED       ${label}` : `ALLOWED (absent) ${label}`;
  if (status === 200) return deny ? `!! EXPOSED       ${label}` : `ALLOWED (found)  ${label}`;
  return `? ${status}         ${label}`;
}

/**
 * The owner-scoped paths can only confirm Stage 1 when the probe asks for the
 * caller's OWN subtree — `aiCache/{writerId}/...` requires request.auth.uid ==
 * writerId, so a made-up uid is denied identically before and after the deploy.
 * The uid therefore comes from the token itself (decoded locally; nothing is
 * printed and the token never leaves this process).
 */
function tokenClaims(bearer) {
  const payload = bearer.split('.')[1];
  if (!payload) throw new Error('the value in ECHOLEARN_PROBE_TOKEN is not a Firebase ID token');
  const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json);
}

async function main() {
  const lines = [];
  let exposed = false;
  let stage1Confirmed = false;
  let authProbes = [];

  lines.push(`project ${PROJECT}  probes ${STAMP}  credential ${token ? 'disposable token' : 'none'}`);
  lines.push('');
  lines.push('unauthenticated reads (every "must deny" path is an exposure check):');
  for (const p of ANONYMOUS_PROBES) {
    const status = await probe(p.path, null);
    if (p.deny && status !== 403) exposed = true;
    lines.push(`  ${verdict(status, p)}   [${p.path}]`);
  }

  if (token) {
    const claims = tokenClaims(token);
    const uid = claims.sub;
    const verified = claims.email_verified === true;
    lines.push('');
    lines.push(`authenticated reads (token uid ${String(uid).slice(0, 6)}…, email_verified=${verified}):`);
    authProbes = [
      { label: 'own private cache subtree (Stage-1 marker)', path: `aiCache/${uid}/analyses/probe-absent-${STAMP}`, deny: false },
      { label: 'own user data (Stage-1 marker)', path: `users/${uid}/data/vocabulary`, deny: false },
      { label: "another uid's cache subtree", path: `aiCache/stranger-${STAMP}/analyses/probe-absent-${STAMP}`, deny: true },
      { label: "another uid's user data", path: `users/stranger-${STAMP}/data/vocabulary`, deny: true },
    ];
    for (const p of authProbes) {
      const status = await probe(p.path, token);
      p.status = status;
      lines.push(`  ${verdict(status, p)}   [${p.label}]`);
    }
    // Stage 1 is proven by the owner's own `aiCache` subtree no longer being
    // denied: pre-campaign rules have no such path, so it answers 403 there and
    // 404/200 once Stage 1 is live. An owner read of `users/...` returns 200
    // whenever the account has data, so it is checked as "not denied" too but
    // says nothing on its own — it is the invariant, not the marker.
    if (verified) {
      const markers = authProbes.filter((p) => p.label.includes('Stage-1'));
      stage1Confirmed = markers.filter((p) => p.label.includes('cache')).every((p) => p.status !== 403);
      if (authProbes.some((p) => p.deny && p.status !== 403)) exposed = true;
      if (markers.some((p) => p.status === 403)) stage1Confirmed = false;
    }
  }

  lines.push('');
  if (exposed) {
    lines.push('RESULT: BLOCKED — a path that must be closed was readable without a credential.');
    lines.push('Do not proceed with the release; investigate the deployed rules first.');
    console.log(lines.join('\n'));
    process.exit(1);
  }
  if (!token) {
    lines.push('RESULT: anonymous half-check passed (nothing exposed). Stage 1 is NOT yet confirmed.');
    lines.push('Confirming Stage 1 needs a read with a verified token; see deploy/RULES_RELEASE.md Stage 2.');
    console.log(lines.join('\n'));
    process.exit(1);
  }
  lines.push(
    stage1Confirmed
      ? 'RESULT: Stage 1 is effective — aiCache is readable by its owner, so the frontend may ship.'
      : 'RESULT: Stage 1 is NOT effective yet — aiCache is still denied, which is the pre-campaign behavior. Wait for propagation and re-run.',
  );
  console.log(lines.join('\n'));
  process.exit(stage1Confirmed ? 0 : 1);
}

main().catch((error) => {
  console.error(`probe failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
