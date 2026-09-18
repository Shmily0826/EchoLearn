/**
 * Is what I pushed the thing that is live? (read-only, no credentials)
 *
 * Vercel reports every deployment back to GitHub as a repository *deployment*
 * (created by `vercel[bot]`) and a commit status, so the deployed commit can be
 * read from the public GitHub API without a Vercel token or `vercel login`.
 * This answers *identity*: which commit Production is running.
 *
 * It deliberately does NOT answer *behaviour* — a deployment record proves a
 * build exists and Vercel considered it successful, not that the running app
 * acts as intended. Use `npm run ai:seek-smoke` for that, and note that
 * `docs/TESTING.md` explains why comparing the local build with the live one is
 * not a valid check in this repository.
 *
 * Usage:
 *   npm run deploy:check                 # compare against the local HEAD
 *   node scripts/prod-deploy-check.mjs --expect <sha>
 *   node scripts/prod-deploy-check.mjs --repo owner/name --branch main
 *
 * Exit codes: 0 = the expected commit is the newest Production deployment and
 * Vercel reports success; 1 = it is not; 2 = network/config error.
 */
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPO = 'Shmily0826/EchoLearn';
const API = 'https://api.github.com';
const HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'echolearn-prod-deploy-check' };

function parseArgs(argv) {
  const args = { repo: DEFAULT_REPO, expect: null, branch: 'main', history: 5, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--repo') { args.repo = next; i += 1; }
    else if (key === '--expect') { args.expect = next; i += 1; }
    else if (key === '--branch') { args.branch = next; i += 1; }
    else if (key === '--history') { args.history = Math.max(1, Number(next)); i += 1; }
    else if (key === '--json') { args.json = true; }
    else if (key === '--help' || key === '-h') { args.help = true; }
    else throw new Error(`unknown argument: ${key}`);
  }
  return args;
}

const HELP = `Usage: node scripts/prod-deploy-check.mjs [options]

  --expect <sha>    commit that should be live (default: the local HEAD)
  --repo <owner/n>  repository (default ${DEFAULT_REPO})
  --branch <name>   branch whose head is used when --expect is omitted (default main)
  --history <n>     how many recent Production deployments to print (default 5)
  --json            print the machine-readable result instead of a report

Read-only and credential-free: Vercel publishes its Production deployments to
GitHub as repository deployments created by vercel[bot].

Exit codes: 0 the expected commit is deployed and built; 1 it is not; 2 error.
`;

/** Read the local HEAD without assuming git is present or the cwd is a repo. */
export function readLocalHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/**
 * Pure decision logic, kept exported so it can be unit-tested without a network.
 * `deployments` is the GitHub deployments list, newest first, filtered to the
 * environment; each entry needs `sha` and `created_at`.
 */
export function compareDeployment({ deployments, expectSha, statusesByDeployment = {} }) {
  const rows = Array.isArray(deployments) ? deployments : [];
  const latest = rows[0] ?? null;
  if (!latest) {
    return { verdict: 'FAIL', reason: 'no Production deployment is recorded for this repository', latest: null, matched: false };
  }
  const latestSha = String(latest.sha ?? '');
  const expect = expectSha ? String(expectSha) : null;
  const latestStatuses = statusesByDeployment[latest.id] ?? [];
  const latestState = latestStatuses.length > 0 ? latestStatuses[0].state : 'unknown';

  if (!expect) {
    return {
      verdict: 'UNKNOWN',
      reason: 'no commit to compare against was supplied and the local HEAD could not be read',
      latest,
      latestSha,
      latestState,
      matched: false,
    };
  }

  const matched = latestSha.startsWith(expect) || expect.startsWith(latestSha);
  if (!matched) {
    return {
      verdict: 'FAIL',
      reason: `the newest Production deployment is ${latestSha.slice(0, 7)}, not the expected ${expect.slice(0, 7)}`,
      latest,
      latestSha,
      latestState,
      matched: false,
    };
  }
  if (latestState !== 'success') {
    return {
      verdict: 'FAIL',
      reason: `the newest Production deployment is the expected commit but its status is "${latestState}"`,
      latest,
      latestSha,
      latestState,
      matched: true,
    };
  }
  return {
    verdict: 'PASS',
    reason: 'the expected commit is the newest Production deployment and Vercel reports success',
    latest,
    latestSha,
    latestState,
    matched: true,
  };
}

async function api(path) {
  const res = await fetch(`${API}${path}`, { headers: HEADERS });
  if (res.status === 403 || res.status === 429) {
    const reset = res.headers.get('x-ratelimit-reset');
    const when = reset ? new Date(Number(reset) * 1000).toISOString() : 'unknown';
    throw new Error(`GitHub API rate limit reached (HTTP ${res.status}); resets at ${when}`);
  }
  if (!res.ok) throw new Error(`GitHub API ${path} returned HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }

  let expect = args.expect;
  let headSource = 'argument';
  if (!expect) {
    const localHead = readLocalHead();
    if (localHead) {
      expect = localHead;
      headSource = 'local HEAD';
    } else if (args.branch) {
      const ref = await api(`/repos/${args.repo}/commits/${encodeURIComponent(args.branch)}`);
      expect = ref.sha;
      headSource = `remote ${args.branch}`;
    }
  }

  const deployments = await api(
    `/repos/${args.repo}/deployments?environment=Production&per_page=${args.history}`,
  );
  const statusesByDeployment = {};
  for (const d of deployments) {
    statusesByDeployment[d.id] = await api(`/repos/${args.repo}/deployments/${d.id}/statuses`);
  }

  const result = compareDeployment({ deployments, expectSha: expect, statusesByDeployment });

  if (args.json) {
    console.log(JSON.stringify({ repo: args.repo, expect, headSource, ...result }, null, 2));
  } else {
    console.log(`repo      ${args.repo}`);
    console.log(`expected  ${expect ? expect.slice(0, 7) : '(unknown)'}  (from ${headSource})`);
    console.log(`\nrecent Production deployments (newest first):`);
    for (const d of deployments) {
      const st = statusesByDeployment[d.id]?.[0];
      console.log(
        `  ${String(d.sha).slice(0, 7)}  ${d.created_at}  status=${st?.state ?? 'unknown'}  ${st?.environment_url ?? ''}`,
      );
    }
    console.log(`\nDEPLOYMENT: ${result.verdict} — ${result.reason}`);
    if (result.verdict === 'FAIL' && result.matched) {
      console.log('  the commit is deployed but Vercel has not reported success for it yet');
    } else if (result.verdict === 'FAIL' && expect) {
      console.log('  either no deployment has been created for that commit yet, or the alias has not moved to it');
    }
    console.log('\nIdentity only — this does not prove the running app behaves as intended. Use npm run ai:seek-smoke for behaviour.');
  }

  return result.verdict === 'PASS' ? 0 : result.verdict === 'FAIL' ? 1 : 2;
}

// Keep the module importable from tests without running the CLI.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = await main().catch((error) => {
    console.log(`ERROR  ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  });
}
