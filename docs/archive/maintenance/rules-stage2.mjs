/**
 * Generate the Stage-2 rules artifact deterministically from the Stage-1 file,
 * so the release never depends on someone re-typing a rules edit from memory.
 *
 * Stage 1 (firestore.rules) keeps legacy flat `feedback/{docId}` create allowed,
 * because the frontend currently in Production still submits there.
 * Stage 2 tightens that one condition to `if false` AFTER the new frontend is
 * deployed and verified, so nobody can keep adding to the orphan-prone shape.
 *
 *   node scripts/rules-stage2.mjs            # print the diff summary
 *   node scripts/rules-stage2.mjs --write    # write deploy/firestore.stage2.rules
 */
import fs from 'node:fs';

const SOURCE = 'firestore.rules';
const TARGET = 'deploy/firestore.stage2.rules';

// The exact block, anchored on its own comment so a silent no-match is impossible.
const ANCHOR = 'allow create: if isVerified()\n        && request.resource.data.userId == request.auth.uid\n        && request.resource.data.text is string\n        && request.resource.data.text.size() > 0\n        && request.resource.data.text.size() < 5000\n        && (request.resource.data.userEmail is string || request.resource.data.userEmail == null)\n        && request.resource.data.createdAt == request.time;';
const REPLACEMENT = 'allow create: if false; // STAGE-2: the nested subtree is the only shape clients may write';

const source = fs.readFileSync(SOURCE, 'utf8');
const normalized = source.replace(/\r\n/g, '\n');
const occurrences = normalized.split(ANCHOR).length - 1;

if (occurrences !== 1) {
  console.error(`FAIL: expected exactly 1 legacy flat-feedback create block in ${SOURCE}, found ${occurrences}.`);
  console.error('Stage-1 rules changed shape; update this generator deliberately rather than releasing a stale Stage-2.');
  process.exit(1);
}

const stage2 = normalized.replace(ANCHOR, REPLACEMENT);

if (process.argv.includes('--write')) {
  fs.writeFileSync(TARGET, stage2);
  console.log(`wrote ${TARGET} (${Buffer.byteLength(stage2)} bytes, one condition tightened)`);
} else {
  // Line positions shift when a 7-line condition becomes 1 line, so compare
  // line sets: the difference is exactly the removed condition plus the
  // replacement, which is the whole Stage-1 -> Stage-2 change.
  const removed = ANCHOR.split('\n');
  const added = REPLACEMENT.split('\n');
  console.log(`${SOURCE}: ${Buffer.byteLength(normalized)} bytes -> Stage 2: ${added.length} line(s) in, ${removed.length} out`);
  console.log(`  - ${removed[0].trim()}`);
  console.log(`  + ${added[0].trim()}`);
  console.log('sanity: nested owner rules untouched =', /match \/feedback\/\{userId\}\/messages\/\{messageId\}/.test(stage2));
  console.log('sanity: user data rules untouched   =', /match \/users\/\{userId\}\/data\/\{collection\}/.test(stage2));
  console.log('sanity: legacy create denied         =', stage2.includes('allow create: if false;'));
}
