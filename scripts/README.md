# EchoLearn maintenance scripts

Run commands from the repository root with Node 24. The
[testing guide](../docs/TESTING.md) owns the normal test sequence. The
[release checklist](../docs/RELEASE_CHECKLIST.md) owns deployment acceptance.

## Local checks and tools

| Entry point | Purpose |
| --- | --- |
| `npm run test:ci` | Application unit tests, build, lint and Firestore emulator. [Emulator runner](run-firestore-emulator.mjs) starts the local Firebase process. |
| `npm run test:worker`, `npm run test:reliability`, `npm run test:vps` | Worker, [reliability tooling](reliability-baseline) and VPS test suites. CI calls the same commands. |
| `npm run dict:eval:synthetic` | Offline dictionary smoke using the committed [synthetic CSV](fixtures/dictionary-eval.synthetic.ecdict.csv). |
| `npm run dict:eval` and `npm run dict:context` | Offline vocabulary coverage and contextual-sense evaluation against a supplied ECDICT CSV. See the [word list](dictionary-evaluation-words.txt), [context fixture](fixtures/dictionary-context-eval.local.json) and [test](__tests__/dictionaryContextPoc.test.ts). |
| `npm run ai:rubric -- --transcript <file> --response <file>` | Score a saved response against the application's prompt candidates. Both inputs are local JSON files. See [offline examples and provider opt-in](ai-quality-rubric.mjs). |
| `node scripts/generate-pwa-icons.mjs` | Regenerate PNG assets in `public/`. Run for icon changes and review the resulting assets. |

The YouTube API test and dictionary context test are discovered by Vitest.
Files named `*.test.mjs` in the reliability folder are discovered by
`npm run test:reliability`.

## Live probes and release helpers

| Entry point | Boundary |
| --- | --- |
| `npm run deploy:check -- --expect <sha>` | Reads the GitHub deployment record for Vercel. It checks revision identity. |
| `npm run health` | Contacts deployed endpoints. The [uptime workflow](../.github/workflows/uptime-monitor.yml) runs it on a schedule. Its paid probe uses the [paid-provider guard](paid-provider-guard.mjs). |
| `npm run ai:seek-smoke` | Browser probe against the deployed app with a QA login. Uses analytics suppression and a provider cap. |
| `npm run ai:rubric` without `--response` | Live AI quality evaluation. Requires QA credentials and explicit paid-provider opt-in with a cap. |
| [Reliability probes](reliability-baseline) | `runner.mjs` measures a fixed caption matrix, `budget-ab.mjs` compares budgets, and `worker-attribution.mjs` queries the Worker diagnostic path. Their shared matrix and attribution modules support these runs and their tests. Consult the [protocol](../docs/RELIABILITY_BASELINE_V1.md) before any live window. |
| [Dictionary AI comparison](dictionary-ai-comparison.ts) | Separate ECDICT research. The tool stops before network calls unless `--allow-provider` is supplied for the configured endpoint. |
| `npm run e2e:real-auth` | Separate Windows QA suite with real Firebase access. Its [credential helpers](../docs/QA_ACCOUNTS.md) read Windows Credential Manager only when the suite executes. |
| [Rules runbook](../deploy/RULES_RELEASE.md) | The rules artifacts are committed and tested by the emulator. `verify-rules-propagation.mjs` probes real rules during an authorized rules release. The old Stage 5 generator is archived. |

The old [dictionary diagnostic](../docs/archive/maintenance/_dict_check.mjs)
compared upstream responses using hand-written word forms. Current
[dictionary semantics tests](../e2e/dictionary-semantics.spec.ts) and the offline
evaluation cover the app's lookup and vocabulary contracts. Upstream
availability remains a separate live check.
