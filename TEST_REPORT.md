# EchoLearn 单元测试报告（2026-08-22，更新于 2026-08-23 晚）

> 本文件是给后续 AI agent / 开发者看的持久化测试报告。
> 状态：**315 单元用例 + 7 条 Round 7 Study E2E + 4 条 Batch 4 media-sync E2E + CI 门禁 + 每日拨测，全部在线**。

## 2026-08-24 Batch 5：字幕 provider fallback / resilience 回归

> 任务 ECHO-20260824-1832。Batch 4 已推送并由 Vercel 自动部署；本轮继续在现有工作区半成品上补齐 provider 降级边界。Batch 5 本地提交，未 push。

### Batch 4 release gate

- `origin/main` 与 Batch 4 commit `8f8e823740e82b7f8b95df36543fe09f261d46d1` 一致；本轮执行 `git push origin main` 返回 `Everything up-to-date`，没有产生额外 push。
- Vercel production deployment `dpl_4hbGR5ssGNHyiuEE2AT8jkvXr8U5`：**READY**，revision 为 `8f8e823740e82b7f8b95df36543fe09f261d46d1`。
- 生产首页当前 HTTP **200**。此前 Round 7 的 production Study / Guest / YouTube smoke 仍是已记录证据；本轮未重新制造真实外部字幕生成。

### Provider 实际链路审查

- **浏览器 YouTube**：local proxy（4s，失败后 5 分钟跳过）→ CF Worker `/api/transcript` → same-origin Vercel `/api/transcript` → InnerTube（ANDROID → WEB）→ 页面 `ytInitialPlayerResponse` / timedtext → `youtube-transcript` npm fallback。
- **YouTube CF Worker**：VPS yt-dlp → VPS ASR/Whisper（若配置）→ InnerTube → Web page → Worker Whisper → Invidious → Piped。Vercel `/api/transcript` 保留 server-side VPS（`YTDLP_API_KEY` 不出浏览器）→ `youtube-transcript` fallback。
- **浏览器 Bilibili**：CF Worker `/api/bilibili` → same-origin Vercel `/api/bilibili`；短链元数据为 Worker `/api/info` 两次尝试 → Vercel info fallback。Worker Bilibili 走 VPS API-direct ASR（view → playurl → CDN audio）→ yt-dlp native subtitles fallback，避免直接打开 Bilibili watch page 的 412。
- **超时边界**：YouTube server endpoint 120s；Bilibili transcript 180s；Bilibili metadata Worker 12s、Vercel 30s；底层 `fetchWithTimeout` 在 finally 清理 timer。

### 本轮修复与测试

- `src/services/bilibiliTranscript.ts`：不再把 Worker 的 2xx 空字幕或 malformed JSON 当作最终成功；会继续请求 Vercel fallback，并在两端都不可用时返回明确的 `no usable lines` / 最后错误。
- `src/services/__tests__/bilibiliTranscript.test.ts`：补 Worker 空 payload → Vercel 成功、Worker malformed JSON → Vercel 成功、两端均不可用的回归；保留 5xx、网络/timeout、短链冷启动重试、无 bvid、全失败等既有覆盖。
- `src/services/__tests__/youtubeTranscript.test.ts`：补 YouTube Worker 2xx malformed JSON → Vercel 成功，另覆盖 5xx、网络失败、AbortError、空 lines、双端失败。
- `src/utils/__tests__/resilientFetch.test.ts`：补慢但在预算内成功（900ms/1000ms）和到达边界触发 AbortError；修复了测试监听 rejection 的时序，避免 Vitest unhandled rejection 假失败。

### 实际验证

- `npm test`：**315/315 PASS**，22 个测试文件。
- 定向 provider/resilience：**28/28 PASS**，3 个测试文件。
- `npm run lint`：0 errors，12 个既有 warnings。
- `npx tsc -b`：PASS。
- `npm run build`：PASS；仅既有 chunk size / plugin timing 提示。
- `npm run e2e -- --reporter=line`：沙箱首次运行因 Chromium `spawn EPERM` 无法启动；放行浏览器进程后重新运行，**11/11 PASS**（7 existing Study + 4 Batch 4 media）。
- `git diff --check`：PASS；生产首页 HTTP 200。

### Observability / limitations

- 当前 fallback 链已有 strategy、HTTP 状态、malformed/empty payload、timeout/network failure 的 console diagnostics；生产 debug payload 仍由显式 `ALLOW_DEBUG=1` 控制，未增加敏感信息日志。
- 本轮未执行真实 provider matrix：未对 YouTube 具体视频逐一强制触发每个 Worker/InnerTube/Invidious/Piped 分支，未执行真实 Bilibili 短链和 ASR 生产请求，未复现真实 uncached 1–2 分钟生成，也未做 Android Chrome/iOS Safari、PWA 后台生命周期或 Auth/Firestore 数据生命周期验证。

## 2026-08-24 Round 7 deployment / production validation

> 任务 ECHO-20260824-1808。Round 7 已完成 pre-push review 并推送；Batch 4 随后完成本地验证，但不推送。

### Release

- Round 7 commit：`ea66032bab3293960e04400e6becad70e711c274`，已正常 push 到 `origin/main`。
- Vercel production deployment：`dpl_6RSGzGfeqxraaA26KRYuRtXjJo4g`，状态 **READY**。
- Deployed revision：`ea66032bab3293960e04400e6becad70e711c274`，与 push commit 一致。
- Production aliases：`echo-learn.uk`、`app.echo-learn.uk` 等已指向该 deployment。

### Production smoke

- Availability：`https://echo-learn.uk/` HTTP **200**；标题为 `EchoLearn — Learn English from YouTube Videos`。
- Guest → Study：可进入 Study。
- English Study：已检查 `加载中`、`前往平台观看`、`来源：`、中文时长单位及同一 Study surface，未发现已知中文 UI 泄漏。
- Guest vocabulary：保存 `good` → Words 显示 `1 words` → 删除后显示 `0 words`；使用 fresh browser context，未登录、未写入 Firestore。
- Real YouTube first load：`iG9CE55wbtY` 加载成功；transcript 可见，Load 按钮恢复为 `Load Video`，无 loading/error contradictory state。
- 该视频是否为 uncached、是否复现 1–2 分钟 Whisper 首次生成未能从 smoke 中确认；真实 uncached slow-load 仍是生产风险，不作已验证成功声明。
- 首次 smoke 的整句 selector 选中了隐藏移动端副本，修正为 visible locator 后完整 smoke 通过；这不是生产故障。

## 2026-08-24 Batch 5 Production Validation

> 任务 ECHO-20260824-1858。Batch 5 已完成 pre-push review、push、Vercel production deployment 和真实 provider smoke；本节只记录实际观察到的结果，不把未执行场景标为 PASS。

### Release

- Batch 5 commit `031b516f9699226103fd147890c84ef67c954369` 已 push 到 `origin/main`。
- Vercel deployment `dpl_649QGxBGhC6LR6FV6WNeArDkogEZ`：**READY**。
- Deployed revision：`031b516f9699226103fd147890c84ef67c954369`；production aliases 包含 `echo-learn.uk`、`app.echo-learn.uk`。
- `https://echo-learn.uk/` 当前 HTTP **200**。

### Real provider smoke

| Case | Fixture / evidence | Result | Latency / UI evidence |
|---|---|---|---|
| YouTube normal | `https://www.youtube.com/watch?v=iG9CE55wbtY` | **PASS** | Study UI 约 12.6s，554 transcript lines；loading 消失、无 error、无需刷新。Worker API 独立请求约 0.3s，427 lines，language `en`。 |
| Bilibili canonical | `https://www.bilibili.com/video/BV1emBiYcEAV/` | **PASS** | Study UI 约 55.6s，278 lines；无 loading/error。Worker API 约 39.5s，132 lines，language `English`，source `asr`。 |
| Bilibili short-link | `https://b23.tv/nbSyQzx` | **PASS** | Worker info 约 7.8s，解析为 `BV1X54y1p7Dd`、标题为 Easy English 合集、72 P；Study UI 约 30.6s，270 lines，无刷新。 |

### ASR / slow path / fallback

- Real Bilibili ASR：**PASS**。canonical 和 short-link 生产请求均自然返回 `source=asr`，未人为关闭 Worker 或制造故障。
- Real uncached 1–2 minute YouTube generation：**NOT EXECUTED / pending**。本轮使用稳定既有 fixture，没有清理生产缓存或强行制造慢请求；自动化 delayed-success/timeout 回归仍为有效证据。
- Live forced Worker → Vercel outage：**NOT EXECUTED**。确定性 mock 已覆盖 Worker empty/malformed/network/5xx → Vercel fallback；本轮未破坏生产 Worker 来制造故障。
- 生产 smoke 未观察到 product error、stale failure、success + loading 矛盾状态或需要刷新才能显示字幕的问题。

### Observability and remaining gaps

- 正常成功请求没有触发需要查看的生产错误日志；现有代码会记录 provider/strategy、HTTP 状态、timeout/network failure、malformed/empty payload 和最终耗尽信息，debug payload 仍由显式配置控制，不包含凭据。
- 未覆盖：真实 uncached 慢生成、强制 live fallback、Android Chrome、iOS Safari、PWA 后台生命周期、Auth/Firestore 生命周期。
- Batch 6 Mobile/PWA testing：本轮明确未开始。

## 2026-08-24 Batch 4：Media Synchronization

### 原实现与边界

- `usePlaybackPosition` 每 100ms 从 `PlayerHandle.getCurrentTime()` 读取媒体时间（单位：秒），负责 currentTime、位置持久化和 playback rate。
- `useTranscriptSeek` 原本在 hook 内用 `start <= currentTime < end` 计算 `activeLineIndex`，并处理 transcript seek/deep-link。
- Bilibili 原生跨域 iframe 不提供可信的播放时间/控制 API，因此同步 transport 仍是 AudioPlayer；本轮未改变该产品边界。

### 提取与语义

- 新增纯函数 `src/utils/transcriptSync.ts`：`getActiveLineIndex(lines, currentTime)`。
- `useTranscriptSeek` 改为复用该 helper；没有改变已有行为或引入新的同步架构。
- 语义：时间单位秒；`start` inclusive；`end` exclusive；精确 end 边界归下一条相邻字幕；空档、首条之前、末条之后返回 `-1`；按 normalized display 顺序查找，不自动排序。

### 新增测试

- `src/utils/__tests__/transcriptSync.test.ts`：11 条纯函数用例，覆盖空字幕、首条前、start、内部、end 边界、相邻边界、gap、前进跳跃、后退 seek、最后一条、最后之后。
- `e2e/media-sync.spec.ts`：4 条 StudyPage + AudioPlayer 浏览器集成用例，使用受控 HTMLAudioElement `currentTime`/`timeupdate`，覆盖 time advance、pause、seek forward/backward、playback rate。
- Media E2E 独立结果：**4/4 PASS**；重复一次：**8/8 PASS**。
- Existing Study E2E：**7/7 PASS**（Happy 1/1、Failure Recovery 5/5、English i18n 1/1）。
- Full standard E2E：**11/11 PASS**（7 existing Study + 4 Batch 4 media）。

### 工程验证与限制

- `npm test`：**311/311 PASS**，21 个测试文件。
- `npm run lint`：0 errors，12 个既有 warnings。
- `npx tsc -b`：PASS。
- `npm run build`：PASS；仅有既有 chunk size / plugin timing 提示。
- `npm run e2e -- --reporter=line`：11/11 PASS。
- `git diff --check`：PASS。
- 本轮未发现需要修改的同步产品 bug；未修改字幕数据模型、播放器架构或 Bilibili iframe 行为。
- 未覆盖：真实 uncached 1–2 分钟 provider generation、Bilibili 真实短链 fallback、真实外部 provider 矩阵、Android Chrome、iOS Safari、PWA 后台/前台生命周期、Auth/Firestore 数据生命周期。

## 2026-08-24 第七轮收尾：刷新持久化取证与测试修复

> 任务 ECHO-20260824-1722。继续 Batch 3 / Round 7，未开始 Batch 4；本轮只修正 E2E 测试清理逻辑，不改变产品存储或游客生命周期。

### 一、R0–R9 runtime evidence

| 检查点 | 实际结果 |
|---|---|
| R0 fresh context / Home | URL `/`；`echolearn_vocabulary=null`；仅有 tour marker；仍在加载，Guest 尚未可见 |
| R1 after Try without login | URL `/`；词汇 `null` / 0；Guest app 已挂载，Dashboard 可见 |
| R2 immediately after Save | URL `/study`；词汇 JSON 为 1 条；保存词 `good` 存在 |
| R3 before reload | URL `/study`；词汇 JSON 仍为 1 条；`good` 存在 |
| R4 immediately after reload | 词汇变为 `null` / 0；这是关键失败点 |
| R5 after AuthGate settles | 仍为 `null` / 0；登录界面可见 |
| R6 after re-entering Guest | 仍为 `null` / 0；Study 已挂载 |
| R7 before Words | 仍为 `null` / 0；Study transcript 尚在 |
| R8 after Words mount | URL `/vocabulary`；storage 0；Words UI 未显示 `1 words` |
| R9 after UI settle | storage 0；UI 0；保存词不可见 |

### 二、根因分类与修复

- **分类：测试 bug，不是产品持久化 bug。** `seedCleanVisitor()` 通过 `page.addInitScript()` 清理 localStorage；该脚本也会在 `page.reload()` 的新 document 中再次执行，直接删除 `echolearn_vocabulary`。
- storage mutation instrumentation 进一步确认：首次 Save 由 `saveVocabulary()` 写入 1 条；reload 前的清理发生在 instrumentation wrapper 安装前；随后 enrichment 的 `updateVocabularyItem()` 只看到空集合并写回 0 条。这是测试初始化顺序造成的假象，不是生产代码主动清空。
- 修复：`seedCleanVisitor()` 使用 fresh context 级 `sessionStorage` marker，只在首次 document 清理；reload 不再重置被测 localStorage。未持久化 `guestMode`，未修改词汇 schema、AuthGate 或产品 storage。

### 三、Force-click audit

- 删除按钮已从 `click({ force: true })` 改为普通 `click()`。
- Save → Words → Delete 独立 E2E 通过；没有发现 overlay、disabled 或其他被 force click 掩盖的真实 UI 问题。

### 四、最终验证

- Refresh persistence：独立连续 **3/3 PASS**。
- Failure Recovery：**5/5 PASS**（Retry、Save/Delete、Duplicate、Invalid URL、Refresh）。
- English i18n：**1/1 PASS**；检查 Study 英文 UI 无已知中文泄漏。
- Happy Path：**1/1 PASS**。
- 标准 `npm run e2e -- --reporter=line`：**7/7 PASS**（59.2s）。
- `npm test`：**300/300 PASS**，20 个测试文件。
- `npm run lint`：**0 errors，12 个既有 warnings**。
- `npx tsc -b`：PASS。
- `npm run build`：PASS；仅保留既有 chunk size / plugin timing 提示。
- `git diff --check`：PASS。

### 五、范围与遗留

- 临时 R0–R9、storage mutation、request/response 调试日志均已移除；无临时 spec、trace、截图或视频进入 Git 状态。
- `src/**/*.js` 生成物：0；`vite.config.js`：不存在；`vite.config.ts` 保留。
- Batch 4 Media Synchronization：未启动。
- 本轮改动待 amend 到未 push 的本地 `a100ad7`；不得 push。

## 2026-08-24 第七轮：Cleanup 编译产物遮蔽 + 修复首次加载 race 与英文 i18n 泄漏 + regression

> 任务 ECHO-20260824-0950（暂停 Batch 4 Media Sync）：先修两个真实浏览器 bug（首次加载字幕 race、英文 UI 中文泄漏），补 regression coverage，再继续测试。仅本地 commit，未 push。Batch 4 未启动。

### 一、删除 87 个 stray `src/**/*.js`（TypeScript 编译旁产物）

- **根因**：早期某次 `tsc` 把 emit 写进了 `src/`，生成了与每个 `.ts`/`.tsx` 同名的 `.js`。现行 `tsconfig.app.json` 已 `noEmit: true`，`build` = `tsc -b && vite build` 不再 emit，**所以根因已消除，无需改 tsconfig**。
- **遮蔽危害**：Vite `resolve.extensions` 默认 `['.mjs','.js',...,'.ts','.tsx']` → `.js` 优先于 `.ts` 被解析。此前所有 vitest / build 实际跑的是**旧版 `.js`**，源码 `.ts` 的改动（含本任务的 bugfix）根本没生效——这是"改了却不像改了"的真凶。
- **核验**：87 个 `.js` 全部 `git ls-files` 为 0（untracked，删了不破坏版本库）；全部都有 `.ts`/`.tsx` 孪生兄弟（`no_twin=0`）；已完整备份至 `/tmp/echolearn-src-js-backup/src`（87/87 一致）。
- **删除**：trash 机制（gio / Shell COM）均被 sandbox 安全策略拦截；项目目录 `D:\CODE\project\EchoLearn` 非个人 No-Go 区，且备份就绪、0 tracked，按用户二次确认用 `rm` 分批 ≤10 清空（9 批，最后一批 7），删除后 `find src -name '*.js'` = 0。
- **副作用修复**：删除后重跑 `tsc -b`，暴露并修掉一处类型错误——`transcriptSourceLabel` 的参数类型 `Record<string, unknown>` 与 `useI18n().t` 的 `Record<string, string | number>` 逆变不兼容，改为 `Record<string, string | number>`；并删掉 `useCaptionRequest.test.ts` 里一个未使用变量 `d`。

### 二、Bug 1 — 首次加载未缓存 YouTube 视频字幕 race

- **现象**：首次加载未缓存视频，后端实际几分钟内生成完字幕，但前端约 2 分钟后报失败；刷新后字幕立刻出现。截图里同时存在"Subtitles loaded — 744 lines"横幅 + "Fetching captions…" 转圈 + Load 按钮 loading——状态自相矛盾。
- **真因（两处）**：
  1. `useCaptionRequest.begin()` 不清空 `fetchToast`，导致**上一次的成功横幅能与新的 loading 状态共存**（正是截图里的矛盾 UI）。
  2. 服务端抓取超时太短：`fetchYouTubeServerTranscript` 的 CF Worker 18s + Vercel 45s = 63s，而产品文档 `study.mayTake` 写明首次加载 1–3 分钟（后端 uncached Whisper 生成）。前端在后端写入缓存前就放弃报错了 → 刷新走缓存才成功。
- **修复**：
  - `useCaptionRequest.ts`：`begin()` 内 `setFetchToast(null)`，新请求开始即清旧成功横幅。
  - `youtubeTranscript.ts`：CF Worker 与 Vercel server API 的 `timeoutMs` 由 18000 / 45000 提到 **120000**（有界，依据 `mayTake` 1–3min；若 serverless 平台硬限更短，最坏情况仍需后端侧调优，已记录）。
  - `FetchToast` 接口 `time: string` 改为 `seconds: number`（去掉中文 "0秒" 格式，由 `study.fetchElapsed` 模板本地化）。

### 三、Bug 2 — 英文 UI 中文泄漏

- **泄漏点**：`StudyPage.tsx` 硬编码 `加载中…` / `视频仍在准备中` / `来源：`，以及 `transcriptSourceLabel` 模块函数的中文字面量（AI 转录 (Whisper) / VPS 直连 / YouTube 官方字幕 / B 站官方字幕 / Source:）。
- **修复**：全部改为 `t(...)` 键；`transcriptSourceLabel` 改为接收 `t` 作为首参并本地化所有分支；新增键 `study.sourceLabel / sourceWhisper / sourceVpsDirect / sourceYoutubeAuto / sourceYoutubeOfficial / sourceBiliOfficial / videoNotReady`、`common.close`。
- **连带修正**：`transcriptSourceLabel` 对 `source:'youtube'`（普通官方字幕）此前走了 `sourceGeneric` fallback → "Source: youtube"，再叠加 toast 外层的 `sourceLabel`（"Source: "）造成**双重 Source:**。修正为 platform==='youtube' 且 source 为 `'youtube'`/undefined → `sourceYoutubeOfficial`；`'auto'`/`isAutoGenerated` → auto；`whisper|asr` → Whisper；`vps` → VPS direct；其余 generic。toast 渲染端去掉 `sourceLabel` 外层包裹，直接显示已本地化的 label。

### 四、Regression + i18n 覆盖

| 测试 | 类型 | 覆盖点 |
|---|---|---|
| `useCaptionRequest.test.ts` 新增 3 用例 | 单测 | `begin()` 清空旧成功横幅（不共存）；delayed-success（loading→success，loading 清除、无 error）；late-stale-failure 不能覆盖 success（isCurrent 守卫） |
| `e2e/study-english-i18n.spec.ts` + `e2e-english-i18n-run.mjs` | E2E（standalone runner 规避 reporter safe-delete 崩溃） | en 环境下 Load 成功 → 断言页面**无中文**、toast 显示 "YouTube official subtitles" 而非 "Source: youtube" |

### 五、验证结果（真实跑过）

- `npx tsc -b` ✅（0 错误）
- `npx vitest run` ✅ **300/300**（原 297 + 新增 3 regression；其中 `useCaptionRequest` 共 16 用例）
- `node build-noempty.mjs`（emptyOutDir:false 绕过 sandbox 清 dist 拦截）✅ exit 0；`dist` 已备份 `/tmp/echolearn-dist-backup` 后重建
- English i18n E2E ✅（PASS：无中文泄漏，toast 英文正确）

### 六、未覆盖 / 遗留

- `vite.config.js`（untracked，与 `vite.config.ts` 并存，JS 优先可能遮蔽 TS 配置）——本轮未动以免扩大范围，建议后续单独核对删除。
- `vite.config.ts` 之外的运行时配置（CF Worker / VPS）未触及。
- Batch 4（Media Synchronization）未启动。

### 七、git 状态

分支 `main`，本轮 bugfix + regression + 清理 `.js` **未 push**（用户明确要求仅本地 commit）。`TEST_REPORT.md` 本轮为追加，历史轮次保留。

## 2026-08-23 第六轮：Study 失败恢复 E2E（Batch 3，5 场景全绿）

> 路线优先级依据用户的 7 项测试路线图中 Batch 3（Study failure recovery）：
> Retry + invalid URL + timeout + fallback + state recovery。这是当前最该先补的一层。

### 新增文件

- `e2e/study-failure-recovery.spec.ts`：Playwright test-runner 格式，5 个失败恢复场景（CI/ubuntu 可跑）。
- `e2e-batch3-run.mjs`：Playwright Library API 独立 runner（绕过本机沙箱 safe-delete 对 output-dir 清理的崩溃，真实浏览器 + 真实 DOM，网络全 mock）。本地验证用这个；test-runner 版留给 CI。

### 5 个场景（全部 PASS，2026-08-23 实跑）

| # | 场景 | 验证点 | 关键 mock 手法 |
|---|---|---|---|
| 1 | Retry: 500 → 错误卡 → 重试 → 成功 | 所有策略（本地代理 / CF Worker / Vercel / InnerTube / 网页抓取 / npm）首次全 500，错误卡 + Retry 按钮出现；翻 phase 后重试成功渲染字幕 | `**/api/transcript**` 统一接管所有 host，`phase` 函数首轮 `fail` 次轮 `ok`；`youtube.com`/`youtubei` abort 让回退链快速耗尽 |
| 2 | Save word 全链 + 删除 | 游客模式点词 → 词典弹窗 → 保存 → Words 页 `1 words` → 删除 → `0 words` | `/api/dictionary` mock + 真实保存/删除链路 |
| 3 | Duplicate 保存 → 计数保持 1 | 已存词再次点开弹窗显示 `Already in vocab`（UI 层去重），计数不重复 | 同一 token 二次点击断言 dedup 文案 |
| 4 | Invalid URL → 页面存活 → 有效 URL 恢复 | 提交非 URL 不崩溃、输入框仍可编辑；随后有效 URL 正常加载字幕 | 先填非法串（parseYouTubeId 返回 null 早返回），再 load 有效 URL |
| 5 | Load + 刷新持久化 | 保存生词后 `reload`，游客态下 Words 计数仍为 1（localStorage 持久化） | `reload` 后重新点"Try without login"进 Words |

### 测试过程中修正的断言陷阱（供后续 agent 复用）

- **`getByText(text, {exact:true})` 大小写敏感**：mock 文案 `Good morning everyone` 的 token 是 `Good`，用小写 `good` + exact 永远匹配不到。改用 `getByText(/good/i)`（正则大小写不敏感）。
- **整行文本被拆成逐词 `<span>`**：不能对整行 `getByText('Welcome to this lesson', {exact:true})`——每个词是独立 span。改用唯一标记词 `zebraxyz`（仅出现在 mock 载荷，不会与自动加载的示例视频字幕撞车）作为"mock 已渲染"的探针。
- **Study 页 mount 会自动加载示例视频 `iG9CE55wbtY`**（无网络）：`loadYoutubeUrl` 必须在示例自动加载 settle 之后再发，否则示例会覆盖我们加载的 `dQw4w9WgXcQ`。`gotoStudy` 之后固定 `waitForTimeout(2000)` 让示例挂载完成。
- **`transcript.wordSaved` 的 en 文案是 `Already in vocab`**（不是 `study.alreadySaved` 的 `Already in vocabulary`）——去重断言要匹配前者。
- **策略链特性**：字幕只在全部 5 个策略都失败时才抛出错误；只要任一策略返回合法字幕就不报错。所以 Retry 测试必须让"所有 host 的字幕接口"首轮都失败。

### 环境与限制

- 本地用 `e2e-batch3-run.mjs`（Library API）实跑：真实 Chromium headless，端口 5173 dev server，网络全 mock。5/5 通过。
- `e2e/study-failure-recovery.spec.ts` 用 test-runner 格式，留给 CI（ubuntu）。本机因 safe-delete 对 output-dir 清理崩溃无法本地跑，非代码问题。
- `npm run lint` / `tsc -b` 通过。`vite build` 本机因 safe-delete 对 `dist/` 清理崩溃（同沙箱限制），Vercel 生产构建正常。

### 测试全景（截至本轮）

vitest 291/291（19 文件）· Playwright E2E 6/6（黄金路径 1 + 失败恢复 5）· CI 门禁（push/PR）· 拨测 5 项/每日 2 次

## 2026-08-23 第五轮：E2E 黄金路径 + CI 门禁（含两个真实 bug 修复）

### 新增

- `e2e/golden-path.spec.ts` + `playwright.config.ts`（`npm run e2e`）：全本地黄金路径——游客登录 → Study 示例字幕渲染 → 点词 → 词典弹窗 → 保存 → Words 页展示 → Dashboard 计数持久化。零外部依赖（用内置示例字幕），CI 可跑（已在 ubuntu runner 验证通过）。
- `.github/workflows/ci.yml`：push/PR 触发 `npm test + build + lint + e2e`（Node 24）。

### E2E 过程中发现并修复的真实 bug

1. **游客无法保存生词/例句**（`54a1f6e`）：`handleAddVocabulary/handleAddSentence` 里残留 `if (!user) return + 登录提示`，与 README 承诺的游客模式矛盾——游客点"+ Add to Vocab"词直接丢失。已移除守卫（云同步本来就有游客 no-op 保护），E2E 即其回归测试。
2. **`useSleepTimer` 渲染期间写 ref**（`76fe1d2`）：被 CI lint 门禁首次运行抓住（本地此前因输出截断漏检），改为 effect 内同步。

### 其他记录

- Dashboard 的统计卡片在保存后不实时刷新（挂载时读取）——已知行为，未修，E2E 用 reload 断言持久化。
- lemmatizer 的 `-ing` 乱补 e 缺陷（`morning→morne`）仍在——E2E 选词时刻意避开；建议尽早修复（见第一轮发现 #2）。
- CI 需 Node ≥22（jsdom 30 / undici 8 的 `webidl.util.markAsUncloneable` 要求），workflow 已固定 Node 24。

### 测试全景（截至本轮）

vitest 291/291（19 文件）· Playwright E2E 1/1 · CI 门禁（push/PR）· 拨测 5 项/每日 2 次

## 2026-08-23 第四轮：生产链路拨测监控（新增，非单元测试）

单元测试覆盖不了的盲区——"外部服务此刻是否在线"——交给定时拨测：

- **`scripts/health-check.mjs`**（`npm run health`）：真实请求 5 个生产端点——网站首页、Worker 的 B 站 info 链（短链同链路）、Vercel B 站备用（顺带验证 `YTDLP_API_KEY` 已配置）、Worker 的 YouTube 字幕、Vercel YouTube 字幕备用。每项带超时+重试+响应体校验，任一失败退出码 1。
- **`.github/workflows/uptime-monitor.yml`**：每天 2 次（09:21/21:21 UTC）跑上述脚本，失败触发 GitHub 的工作流失败邮件通知；支持 Actions 页面手动触发。
- 首次实跑结果（2026-08-23）：**5/5 通过**——整条降级链（含两个 Vercel 备用端点）已在生产环境可用。
- 注意与单元测试的边界：vitest 套件永远 mock 网络；拨测只活在定时任务里，绝不接入 `npm test`。

### 修正记录
- 首跑"网站首页"误报：校验串写死了 `<div id="root">` 的完整标签格式，生产构建的根节点带额外属性。已放宽为 `id="root"` 属性匹配。

## 2026-08-23 第三轮：翻译/词典服务测试 + i18n 修复（+29 用例）

### i18n 修复（本次唯一改动的业务文件）

- `src/i18n/translations.ts`：新增 `study.biliResolveFailed` / `study.biliResolveError` / `study.biliUnrecognized` / `study.videoNotReady` 四个键（中英双语）。
- `src/pages/StudyPage.tsx`：4 处硬编码中文报错（原行 1031/1039/1048/1160）改走 `t()`，与组件内既有用法一致。中文文案逐字保留，用户可见行为不变（仅英文用户从此看到英文报错）。

### 新增测试（mock fetch，不请求真实服务）

- `src/services/__tests__/translationService.test.ts`（18 用例）
  - DeepSeek 层（/api/ai）：成功/缓存命中不重复请求/上下文参与缓存键/对象包裹数组解包/非2xx/网络错误/空内容/非法JSON 均返回 '' 且不缓存失败
  - 快速层（/api/translate）：优先命中并缓存/Google 空结果或网络错误降级 DeepSeek/noDeepSeekFallback 不触发 /api/ai/空词不发请求/降级结果也缓存
  - 批量接口：id 顺序映射/短数组丢缺位/**限流命中时不发任何请求**/空批次不请求
- `src/services/__tests__/dictionaryService.test.ts`（11 用例）
  - 输入防护：空词/纯标点 → null；专有名词（Google 等）跳过所有 API；标点剥离
  - 后端主路径：linkertube 载荷映射（US IPA 优先/全义项扁平化/base_form→lemma）/按语言缓存/**legacy 别名 unprecedent→unprecedented**/502 降级到客户端路径
  - 客户端降级：FreeDict→Datamuse 竞速/lemma 候选优先/全挂返回 null/缓存复用

### 本轮新发现（未修，已钉成文档化用例）

1. **dictionaryService 缓存键双轨**：后端条目按 `word:target` 键存，客户端 fallback 条目按裸 `word` 键存 → fallback 缓存命中前**仍会先发一次注定失败的后端探测**。功能正确但浪费一次请求，统一键名即可消除（`dictionaryService.ts:376` vs `:394`）。
2. 候选词循环在首个命中即返回（行为合理，测试已锁定语义）。

### 累计验证（2026-08-23 实跑）

`vitest` 255/255（16 文件）· `tsc -b` ✅ · `eslint` 0 错误（11 个既有警告）· `vite build` ✅

## 2026-08-23 第二轮：服务降级链 mock 测试（+31 用例）

新增两个文件（不改任何业务源码，全部通过 mock fetch，绝不请求真实服务）：

- `src/services/__tests__/bilibiliTranscript.test.ts`（16 用例）
  - `fetchBilibiliTranscript`：Worker 成功 / Worker 5xx 降级 Vercel / 网络错误降级 / 双端全挂的报错 / 空字幕报错 / URL 参数编码 / source 标记
  - `getBilibiliMetaByUrl`：一次成功 / 冷启动重试 / 双失败走 Vercel / ok-但无-bvid 的重试 / 全失败返回 null（共 2+1 次尝试）
  - `getBilibiliVideoTitle`：成功 / 非 2xx / 网络错误
- `src/api/__tests__/bilibiliHandler.test.ts`（15 用例，沿用 aiNodeHandler 范式）
  - CORS 白名单 / 405 / 400 参数校验（含 SSRF 主机校验）/ 缺 YTDLP_API_KEY 返回 503 / 上游超时 502 / 状态码透传 / X-API-Key 服务端注入且不出现在响应 / Range 头转发与媒体头回传

### 本轮代码审读发现的新问题（未修，按优先级）

1. **`src/utils/resilientFetch.ts:42-70` `fetchWorkerThenVps`（YouTube 字幕路径在用，`youtubeTranscript.ts:709`）存在两处可疑失效**：
   a) Worker 返回**非 2xx**时直接原样返回，**不会**降级到 VPS（只有网络层异常才降级）——与函数文档"if it fails or times out, fall back"不符；
   b) 其 VPS 降级 URL **不带 X-API-Key** 直连 VPS，而 `bilibiliTranscript.ts` 注释明确说 VPS 现已强制鉴权 → 该降级大概率 401。**这与用户手动发现的"YouTube 字幕 Retry 反复失败"高度相关，建议优先核实并修复。**
2. **`getBilibiliVideoTitle`（`bilibiliTranscript.ts:104`）用裸 `fetch`**：无超时（Worker 挂起则永久挂起）、无 Vercel 备用——与同文件其他函数的韧性模式不一致。
3. 小项：`fetchBilibiliTranscript` 的 `JSON.parse` 未包 try（畸形 2xx 响应会把 SyntaxError 原样抛给用户）；StudyPage 3 处硬编码中文报错未走 i18n。

### 给后续 agent 的测试写法提示

- Vitest 4 的 `vi.fn` 泛型是**单函数签名**：`vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()`（双泛型元组写法会挂 tsc）。
- 不要用 `new Response()` mock Worker 响应来判断 `resp.url`——`Response.url` 只读且仅由真实 fetch 设置；用自定义 mockResponse 并以 `as unknown as Response` 断言。

## 如何运行

```bash
npm test        # = vitest run，约 0.3s 跑完
npx vitest      # watch 模式
```

## 验证结果（实际运行过的命令）

| 命令 | 结果 |
|---|---|
| `npx vitest run` | 9 个文件 / **176 通过 / 0 失败**（304ms） |
| `npm run build`（tsc -b + vite build） | ✅ 通过（仅有原有的 chunk >500kB 提示） |
| `npm run lint` | 0 错误；11 个警告全部为**原有**（SettingsPage/StudyPage/VocabularyPage 的 react-hooks/exhaustive-deps），与测试改动无关 |

## 新增文件清单

- `vitest.config.ts` — 独立测试配置（与 `vite.config.ts` / 生产构建完全隔离，未触碰后者）
- `src/test/setup.ts` — 仅包含 localStorage 桩（Node 环境无 DOM）
- `src/utils/__tests__/` 与 `src/services/__tests__/` 下 9 个测试文件（见下表）

对既有文件的修改仅两处（测试必需）：`package.json` 新增 `"test": "vitest run"` 脚本；devDependencies 新增 `vitest@4.1.11`。**没有任何业务源码被修改**；此前未提交的 6 个文件工作区改动原样保留。

## 覆盖范围

| 测试文件 | 用例数 | 覆盖点 |
|---|---|---|
| `storage.test.ts` | 41 | 间隔重复调度（3→7→14→30→90/180/365 天阶梯）、复习计划、词汇/例句/会话/每日计划全部增删改查与去重规则、**localStorage 脏数据容错**（损坏 JSON / 非数组 / null 均返回空不抛异常）、旧数据迁移（timestamp→addedAt）、账号删除时清理范围（保留设备偏好）、变更事件派发 |
| `lemmatizer.test.ts` | 49 | 不规则动词/名词/形容词、缩写展开、规则变形、大小写归一、文档化的规则缺陷（见下） |
| `bilibili.test.ts` | 26 | 平台检测、BV 号各 URL 形态解析、b23.tv 短链语义、分 P / 时间参数、URL 构建 |
| `youtube.test.ts` | 16 | 11 种 YouTube URL 形态的 ID 提取、t=120 / t=1m30s 时间解析、非法输入 |
| `transcriptNormalizer.test.ts` | 12 | 字幕分句：跨块合并、缩写 (Dr.)/姓名缩写 (J.K.)/小数 (3.14)/URL 域名/省略号保护、长句子句级二次切分（内容无损 + 时间戳单调性） |
| `urlExtract.test.ts` | 11 | 多链接取最后一个、中英分享文本、尾部标点剥离及其缝隙 |
| `sentence.test.ts` | 9 | 例句提取：句/子句/截窗三级回退、缩写不误切 |
| `aiRateLimit.test.ts` | 8 | 双滑窗限流（10/分钟 + 100/小时）、窗口滑动、等待时间计算 |
| `id.test.ts` | 4 | ID 前缀与唯一性（5000 次无碰撞） |

## 测试过程中发现的真实缺陷（已钉成文档化用例，源码未改）

修复以下任何一项后，对应测试会失败——**请同步更新测试断言**，它们在 `lemmatizer.test.ts` 的 "documented rule-engine quirks" 和 `urlExtract.test.ts` 的 "documented limitation" 区块。

| # | 现象 | 根因位置 | 影响 |
|---|---|---|---|
| 1 | `stopped → 'stopp'`、`bigger → 'bigg'`（双写辅音不还原） | `src/utils/lemmatizer.ts:442-444` 与 `:516-518`：`hasCVCEnding()` 检查的是**已双写的词干**（如 `stopp`，末三位是 VCC 而非 CVC），规则永远不触发 | 生词去重失效、词典查询用错误词形查询不到 |
| 2 | `walking → 'walke'`、`looking → 'looke'`（乱补 -e） | `src/utils/lemmatizer.ts:425-431`：-ing 规则对任何不以 CVC 结尾的词干都补 e | 同上 |
| 3 | `nicer → 'nic'`、`larger → 'larg'`（不还原哑 e） | `src/utils/lemmatizer.ts:519-524`：-er 规则刻意从不补 e（对 faster→fast 恰好对，对 nicer→nice 错） | 同上 |
| 4 | URL 尾部全角 `）` 不剥离；末尾混入类外字符（如全角 `；`）时**整个剥离失效** | `src/utils/urlExtract.ts:25`：strip 字符类缺全角 `）``；`，且正则锚定 $ 要求全部尾部字符都在类内 | 中文语境粘贴链接解析出脏 URL |
| 5 | URL 中超长 "BV" 串被宽容截断为前 10 字符而非返回 null | `src/utils/bilibili.ts:56`：路径正则 `/\/video\/(BV[a-zA-Z0-9]{10})/i` 未锚定结尾 | 静默得到错误视频 ID |
| 6 | `parseStartTime('?t=abc')` 返回 0 而非 undefined | `src/utils/youtube.ts:73-78`：m/s 正则对垃圾值匹配到空串 | 无害（t=0 即从头播放），仅记录 |

**优先级建议：#1–#3（lemmatizer）> #4 > #5 > #6。** lemmatizer 是生词去重和词典查询的公共路径，三个规则缺陷叠加影响高频学习词汇。

## 刻意设计（非 bug，测试已按现状锁定）

- `was`/`is`/`am`/`has`/`this` 在 `DO_NOT_LEMMATIZE`（`lemmatizer.ts:245-251`）中原样返回 → `sameLemma('was','is')` 为 false，尽管都是 be 的形式。
- `thought` 同时是常用名词，被 `BASE_ER_WORDS`（`lemmatizer.ts:284`）在不规则表之前拦截 → 不会归到 `think`（但 `thinks`/`thinking` 会）。
- `clearAllLocalData()` 保留设备偏好（翻译语言、本地代理 URL），仅清学习数据。

## 未覆盖区域（后续测试路线）

- ~~`youtubeTranscript.ts` 多级回退链（需 mock fetch，价值最高的下一层）~~ → 第六轮已用 E2E 覆盖失败恢复路径（含全策略失败→Retry、invalid URL、刷新持久化）
- `api/`、`cf-worker/`、`vps-ytdlp/` 后端逻辑
- 页面组件（StudyPage 等，待拆分后再测）
- ~~E2E（Playwright，黄金路径 2–3 条）~~ → 第六轮已有 6 条 E2E（1 黄金 + 5 失败恢复）
- B 站短链 fallback（用户路线图中 Batch 3 后续项，尚未覆盖）
- 原生视频同步（audio mode 与字幕行高亮对齐，Batch 4 范围）
- 真实手机端 / 真实 provider 矩阵（Batch 5 范围）

## 给后续 agent 的注意事项

- `aiRateLimit.ts` 有模块级状态：测试通过 `vi.resetModules()` + 动态 import 隔离，改造成单例导出时需同步调整测试写法。
- storage 测试硬编码了 localStorage 键名（`echolearn_vocabulary` 等）——这是有意的契约锁定，改键名时测试会报警。
- 测试文件位于 `src/` 内，会被 `tsc -b` 类型检查覆盖（已验证通过）。

## 当前 git 状态

分支 `main`，本次测试相关改动**未 commit**（含 `vitest.config.ts`、`src/test/`、各 `__tests__/`、`TEST_REPORT.md`、package.json/lock）。用户工作区原有的 6 个文件未提交改动未受影响。

## Production subtitle incident — 2026-08-25

### Incident

- Video: `Zq8e3xX02u8`
- Original behavior: Study waited approximately 2.5–3 minutes, then displayed “This video has no subtitles”; refresh and Retry repeated the failure.
- YouTube player metadata exposed an English auto-generated caption track, so the original message was a false no-subtitles classification.

### Root cause and fix

- The browser ran the slow CF Worker/Vercel server cascade before the faster official InnerTube and YouTube page/player paths.
- The Vercel fallback logged a VPS abort and the `youtube-transcript` npm fallback reported “Transcript is disabled”, neither of which proved captions were absent.
- Official caption discovery now runs before slow server-side generation. Empty timedtext responses continue through the remaining providers, and final failures are reported as retrieval failures with provider HTTP status/body summaries.
- `YouTubeEmbed` now receives the active EchoLearn language and forwards YouTube’s `hl` preference. The player remounts only when the UI language changes, so ordinary video changes do not recreate it unnecessarily.

### Automated validation

- `npm test`: 22 files / 316 tests passed.
- `npm run lint`: 0 errors / 12 pre-existing warnings.
- `npx tsc -b`: passed.
- `npm run build`: passed.
- Standard Playwright E2E: 11 passed. One later full-suite run had a transient first-test guest-mode timeout; the isolated golden-path rerun passed in 12.6s.
- `git diff --check`: passed.

### Production deployment and exact-video retest

- Corrective commits pushed:
  - `013acb1 fix(transcript): recover available YouTube captions`
  - `ef9197f fix(study): refresh YouTube locale on language change`
- Vercel deployments: `dpl_CkzFGnnDShTZuUkTwQgJsYAYRinF` and follow-up `echolearn-ihixqnhkv-shmily0826s-projects.vercel.app`, both READY; production aliases include `echo-learn.uk`.
- Fresh production load of `Zq8e3xX02u8`: subtitles loaded without refresh or Retry; approximately 22 seconds from submit to verified loaded state.
- Source: YouTube official subtitles.
- Success toast reported 804 raw lines; Study displayed 268 normalized subtitle entries.
- No “This video has no subtitles” error appeared.

### Iframe locale validation

- English: PASS — iframe URL contained `hl=en`.
- Chinese: PASS for the requested preference — after switching locale and remounting, iframe URL contained `hl=zh`.
- YouTube-owned iframe wording remains externally controlled; browser/account experiments may still override its visible text.

### Remaining limitations

- Truly uncached Whisper generation may still take 1–2 minutes when no usable official captions are available.
- Batch 6 Android/PWA cases were not continued in this task.

## Golden-path E2E flakiness — 2026-08-25

### Symptom and classification

- The golden path intermittently remained on `LoginPage` after clicking `Try without login`; a later failure snapshot showed the Login page while the test was waiting for the Study link.
- The isolated golden test could pass, so this was classified as a guest-entry test synchronization/isolation problem, not a confirmed `AuthGate` product remount defect. No product source was changed.

### Root cause and fix

- The affected specs used fixed sleeps (`600–1500 ms`) and duplicate onboarding loops after the guest click. Those waits treated a transient guest-button hide as completion and did not assert the stable App shell. They also missed that selecting English dispatches the product's forced first-time tour, and that reload can occur on `/study` without a tour overlay.
- Added `e2e/helpers/guestMode.ts` and reused it from the golden path, media sync, English i18n, and study failure-recovery specs. The helper observes the guest button/LoginPage, language chooser, tour Close control, and visible `/study` navigation; it retries the guest action only if LoginPage is observed again. It uses Playwright state assertions/polling rather than fixed sleeps and preserves the real onboarding path.
- The golden path seeds completed language/tour state because its scope is the guest-to-save journey; onboarding remains exercised by the other guest-mode specs through the same helper.

### Stability validation

- Isolated golden path after the fix: **10/10 passed** (`--repeat-each=10`).
- Full local Playwright suite after the fix: **11/11 passed ×3** (`RESULTS=0,0,0`).
- An intermediate full run correctly exposed and was fixed in the helper: the media specs' language selection triggered the tour, and the reload persistence case was on `/study`; neither required a product change.

## Batch 6 Android Emulator / PWA validation — 2026-08-25

### Release and production smoke

- Authorized commits `66f242f` and `8048d0d` were pushed; `origin/main` now points to `8048d0d`.
- Production homepage sanity: **HTTP 200**, `Server: Vercel`, production alias `https://echo-learn.uk/`.
- Production lightweight smoke: Home → Try without login → Study passed. No provider matrix was repeated because this push contained documentation/E2E changes only.
- The unauthenticated response exposed Vercel request ID `syd1::q7sp9-1787621339104-ca872b7fa2ed`; a deployment ID was not exposed by the available local CLI/HTTP interface.

### Existing physical-device evidence preserved

The Xiaomi 2410DPN6CC evidence remains authoritative and is not relabeled:

- **PHYSICAL DEVICE — PASS:** Home, Study, Words, Dashboard, Sentences, no horizontal overflow.
- **PHYSICAL DEVICE — PASS:** Audio mode, real playback progression, pause, forward seek, backward seek.
- **PHYSICAL DEVICE — PASS:** Chrome background/foreground and lock/unlock with Study/audio state preserved.
- **PHYSICAL DEVICE — PASS WITH LIMITATION:** orientation; the earlier command did not actually rotate the viewport.

### Emulator environment

- **ANDROID EMULATOR:** AVD `Medium_Phone`, Google APIs Play Store image, Android 17 / API 37, `sdk_gphone16k_x86_64`, 1080×2400 physical display, density 420, adb serial `emulator-5554`.
- Chrome: `151.0.7922.137`, package `com.android.chrome`.
- The emulator booted successfully without downloading a new system image or changing system permissions.

### Android browser results

- **ANDROID EMULATOR — PASS:** Production Home → Guest → Study. First-visit language chooser and tour were completed normally.
- **ANDROID EMULATOR — PASS:** Portrait URL input focused; Android software keyboard opened (`mInputShown=true`), input and Load Video remained visible, and the page content resized without a permanent layout break. Keyboard close restored the layout.
- **ANDROID EMULATOR — PASS WITH LIMITATION:** Android Enter/Go was exercised with the known YouTube URL; the field accepted the text, but the result was not used as a provider-success assertion because this was a live production request and the emulator keyboard path did not provide a stable automation-readable completion signal.
- **ANDROID EMULATOR — PASS:** Study sample loaded official YouTube subtitles (61 lines), 1.0× → 1.5× selected without transcript reload/reset, and the active transcript remained present.
- **ANDROID EMULATOR — PASS:** Real portrait → landscape → portrait rotation changed the viewport to 2400×1080. Player and transcript remained usable with no observed horizontal overflow or duplicate video; portrait was restored.

### PWA results

- **ANDROID EMULATOR — PASS:** Chrome offered “Install and create shortcut”; installed app name was `EchoLearn — YouTube English Learning`, and the launcher shortcut was created. Manifest/service-worker-backed install was therefore available in this environment.
- **ANDROID EMULATOR — PASS:** Launcher shortcut opened `com.android.chrome/org.chromium.chrome.browser.webapps.WebappActivity`; the URL bar was absent and the standalone PWA loaded successfully.
- **ANDROID EMULATOR — PASS:** Standalone PWA Guest → Study loaded the current sample transcript, retained the 1.5× state, and Audio mode exposed play/pause and rate controls.
- **ANDROID EMULATOR — PASS:** Saved distinctive guest word `strangers`; Words showed `1 words`. After force-stop/reopen through the launcher shortcut, guest mode was re-entered and Words still showed `1 words`. This confirms local vocabulary persistence while guest auth reset was accepted.
- **ANDROID EMULATOR — PASS:** PWA Study → Home → 8 seconds → Recents showed the Web App task with the Study/player/transcript state intact; foreground restoration succeeded.
- **ANDROID EMULATOR — PASS WITH PHYSICAL CONFIRMATION PENDING:** PWA Study → lock 8 seconds → unlock returned to usable WebappActivity with Study, transcript, selected rate, and controls intact. Emulator evidence does not reproduce Xiaomi/HyperOS process and battery behavior.
- **ANDROID EMULATOR — PASS:** Current strings, subtitle source display, service worker, and reload/relaunch behavior showed no stale pre-fix “no subtitles” state or blank app. No cache was forcibly cleared.

### Physical confirmation pending

Only a small later Xiaomi confirmation remains:

1. Keyboard viewport and Enter/Go behavior.
2. Real portrait ↔ landscape rotation.
3. Guest save → reload/close/reopen persistence.
4. PWA install/open.
5. PWA background → foreground.
6. PWA lock/unlock.

### Batch 6 classification

**COMPLETE WITH PHYSICAL CONFIRMATION PENDING.** No emulator/product bug was found and no product source changes were required in this closure round.

## Batch 7 — Auth + Firestore Lifecycle

### Architecture

| Data | Local storage | Firestore | Identity / merge | Push and pull | Account boundary |
|---|---|---|---|---|---|
| Vocabulary | `echolearn_vocabulary` | `users/{uid}/data/vocabulary` | `id`; union, newer `updatedAt` wins and cloud wins ties | debounced vocabulary mutation; auth-boundary/manual sync | Firestore owner rules; local device data cleared on logout |
| Sentences | `echolearn_sentences` | `users/{uid}/data/sentences` | `id`; same policy | debounced sentence mutation; auth-boundary/manual sync | same |
| Study sessions | `echolearn_session`, `echolearn_sessions_list` | `users/{uid}/data/sessions` | `id`; `updatedAt` / `createdAt`, newest wins; heavy transcript fields remain local | debounced session push; auth-boundary/manual sync | same |
| Daily plan, completed videos, page tokens | local-only keys | none | no cloud merge | local only | cleared by account deletion/logout boundary |
| Language/proxy preferences | local-only | none | no cloud merge | local only | intentionally retained as device preferences |

Guest data is device-local. A verified auth transition now starts `syncWithCloud` from `AuthContext`, so the merge does not depend on Study or Settings having mounted. Firestore documents are owner-scoped and email/password cloud access is verified-email gated; Google users are Firebase-verified.

### Lifecycle and merge results

- **MOCK/DETERMINISTIC — PASS:** Guest local storage remains intact across failed login behavior; the new auth-boundary test verifies successful authenticated state starts the cloud merge.
- **MOCK/DETERMINISTIC — PASS:** local + cloud vocabulary/sentence/session records are unioned, repeated sync is idempotent, and duplicate document IDs remain one item. Identity is `id`, not normalized word text; saving a new word already uses the existing word/video duplicate guard.
- **MOCK/DETERMINISTIC — PASS:** a later local mutation wins even when the original `addedAt` is older. `updateVocabularyItem` / `updateSentenceItem` now stamp `updatedAt`; legacy records continue to fall back to `addedAt`.
- **MOCK/DETERMINISTIC — PASS:** simultaneous sync triggers for one UID share one in-flight request. The duplicate Study mount pull was removed; Settings manual sync remains available.
- **MOCK/DETERMINISTIC — PASS:** logout clears device-scoped learning data after Firebase sign-out, preventing Account A's cached data from becoming Account B's local data. The cloud source remains under Account A's UID.
- **MOCK/DETERMINISTIC — PASS:** an all-category pull failure leaves local data untouched and does not upload empty arrays. A partial pull preserves the failed category and does not upload that category.
- **MOCK/DETERMINISTIC — PASS:** failed lightweight pushes return a meaningful error, set `echolearn_firebase_sync_pending`, and do not write a false last-success timestamp. Unverified accounts are rejected before push.
- **Rules/code inspection — PASS:** user data path is `users/{uid}/data/{collection}` and `firestore.rules` requires matching `request.auth.uid` plus verified email. No unauthorized production probe was attempted.

### Bugs found and fixed

1. **Auth transition had no central pull/merge trigger.** `AuthGate` switched directly from LoginPage to AppContent; only Study/Settings page effects could later pull, so a user could authenticate on another route and see stale Guest-only state. The fix is one auth-state sync trigger in `AuthContext`, with the page-level Study duplicate removed.
2. **Lightweight push swallowed all Firestore failures.** `Promise.allSettled` results were ignored and `lastSync` was written even when every category failed. The fix validates the current verified UID, returns `SyncResult`, logs the category failure, and marks retry state.
3. **A failed pull was represented as an empty cloud collection and could be uploaded back.** Failed categories are now excluded from the merge upload; all-category failure exits before any write.
4. **Conflict comparison used `addedAt` only.** Enrichment, review, and edits could be newer locally while retaining an old creation timestamp. Mutable vocabulary/sentence updates now record `updatedAt`, and merge compares it first.
5. **Logout left device-scoped learning data in place.** The logout boundary now clears study data after successful Firebase sign-out, preventing cross-account local leakage.

### Test environment and validation boundary

- **Mocked Auth/Firestore:** `src/contexts/__tests__/AuthContext.test.tsx` and `src/services/__tests__/firestoreSync.test.ts` cover auth transition, logout isolation, union/dedupe, conflict, concurrent triggers, pull failure, partial recovery, push failure, pending retry state, and unverified-auth rejection.
- **Firebase emulator:** not configured (`firebase.json` contains rules/hosting only); no emulator database was created.
- **Real production account:** not used. Real email delivery/verification and Google OAuth browser confirmation remain pending because no dedicated safe test identity/mailbox was supplied.
- Existing Guest/PWA persistence evidence remains in the Batch 6 section above; this Batch 7 round did not use a real account or modify production data.

### Remaining gaps

There are no Firestore emulator or real-provider lifecycle results in this round. Cross-device deletion has no tombstone model: a successfully pushed local deletion is represented by the next full-array upload, but a stale cloud copy can reappear if a pull races before that upload; this is documented current behavior rather than expanded into a data-model migration. GitHub Gist backup remains a separate manual, PAT-scoped service and is not part of Firebase account isolation.

### Batch 7 classification

**BATCH 7 COMPLETE WITH EXTERNAL AUTH CONFIRMATION PENDING.** Deterministic lifecycle and isolation coverage is green; real Google OAuth and email verification delivery still require a safe dedicated external test path.

### Batch 7 release closure — 2026-08-25

- **Git recovery:** no stale `.git/index.lock` and no active Git process existed. Read-only ACL/process checks showed the sandbox execution identity was denied write access to `.git` metadata; the repository and working tree were otherwise healthy. No ACL, ownership, lock-file, reset, or cleanup operation was performed. A single narrowly scoped escalated Git operation successfully created commit `120b081`.
- **Release:** `120b081 fix: harden auth firestore lifecycle` was pushed from `main`; `origin/main` now points to `120b0819791e9a0c519a4132a7716665697c2934`. The preserved `codex/android-report-20260825` branch remains unchanged at `8a607c6`.
- **Automated post-commit validation:** Vitest 24 files / 325 tests PASS; `npx tsc -b` PASS; lint 0 errors with 12 existing warnings; build PASS; `git diff --check` PASS.
- **Deployment:** Vercel deployment `dpl_BperZ1hDpumo7prH9qMeZhThvGJr` reached READY. Its Git SHA is exactly `120b0819791e9a0c519a4132a7716665697c2934`. Aliases included `echo-learn.uk`, `app.echo-learn.uk`, `echolearn-sepia.vercel.app`, and the main branch alias.
- **Production shell health:** `echo-learn.uk`, `app.echo-learn.uk` (redirected to `echo-learn.uk`), and `echolearn-sepia.vercel.app` each returned HTTP 200. No production data was modified.
- **Production Auth/Firestore smoke:** not executed. No dedicated safe test identity, mailbox, second account, or existing authenticated production browser session was available; no personal account was used and no production data was fabricated. Guest/PWA production evidence remains covered by the earlier Batch 6 report.
- **Final external gap:** real Guest→Google/email login, Firestore pull/push, refresh, logout, and Account A→B smoke evidence still require a safe dedicated test environment or user-provided authenticated session. Deterministic mock coverage remains the authoritative validation for those failure/isolation paths.

### Batch 7 Production Auth/Firestore Lifecycle Validation — 2026-08-25

- **Isolated browser:** standalone Google Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`, launched with a brand-new temporary QA profile under `%TEMP%\EchoLearn-B7-QA-20260825-1544c`, localhost-only CDP on `127.0.0.1:9224`, and Sync disabled. The normal Chrome profile was not reused or terminated.
- **Production revision:** lifecycle testing used the deployed revision corresponding to `677bd5d65656ea432b699f907e29f1f20ea99b48`; production homepage health remained HTTP 200.
- **Guest baseline:** fresh QA profile entered Guest with `0 Saved Words`, `0 Saved Sentences`, and `0 Study Sessions`. Normal Vocabulary UI created `ECHO_B7_GUEST_A_20260825`; it survived page refresh after re-entering Guest.
- **Google Account A — PASS:** OAuth popup created and navigated to Google in the standalone browser. Guest marker was visible after authentication, proving Guest→A local merge. `ECHO_B7_ACCOUNT_A_ONLY_20260825` was added through the normal Vocabulary UI and survived refresh. Settings showed `Last sync: Just now`; sanitized Firestore Listen/Write channel responses returned HTTP 200.
- **Logout A — PASS:** normal Sign Out returned to logged-out state. Re-entered Guest showed `0 words`; both Guest and Account A markers were absent, confirming device-scoped cleanup.
- **Email Account B — partial:** normal email signup returned HTTP 200 from Firebase Identity Toolkit; the manual verification checkpoint was completed. After reload, UI showed `Email verified`, but the first authenticated sync reported `vocabulary`, `sentences`, and `sessions`: `Missing or insufficient permissions.`
- **A→B isolation — PASS for observed visibility:** Account A marker was not visible under B, and B started with zero local vocabulary. B cloud persistence could not be accepted because the initial post-verification sync was rejected by Firestore rules.
- **B persistence / B→A restore:** not completed against the deployed revision because the discovered verification-token bug must be deployed before continuing without producing misleading persistence evidence.

### Production bug found and local fix

- **Symptom:** after Test Account B completed email verification, EchoLearn displayed `Email verified`, but the Auth boundary sync immediately received Firestore permission-denied results for all three collections.
- **Root cause:** Firebase updated the in-memory `User.emailVerified` state, while the cached ID token used by Firestore still lacked the `email_verified` claim required by `firestore.rules`. `AuthContext` started `syncWithCloud` without forcing an ID-token refresh.
- **Fix:** `AuthContext` now calls `user.getIdToken(true)` before the verified-user cloud sync and logs a meaningful refresh/sync failure. Sync is not started if token refresh fails.
- **Regression coverage:** AuthContext tests now cover both successful forced token refresh before sync and the failure path where sync is not started after refresh rejection.
- **Files changed locally:** `src/contexts/AuthContext.tsx`, `src/contexts/__tests__/AuthContext.test.tsx`.
- **Deployment boundary:** the fix is local only and was not pushed or deployed, so the remaining Account B lifecycle steps are intentionally pending.

### Sanitized runtime evidence

- Google popup target creation and callback navigation were visible through CDP in the standalone browser; no credentials, cookies, authorization codes, or tokens were recorded.
- Firebase Auth account lookup and Firestore Listen/Write requests were observed. Account A Firestore channels returned HTTP 200. Account B verification requests succeeded, followed by Firestore permission-denied results.
- An unrelated existing `proxy.echo-learn.uk/health` CORS failure was observed; it did not block Google Auth or explain the Account B Firestore permission failure.
- The earlier Codex built-in Browser OAuth white-popup result remains classified as `CODEX BROWSER ENVIRONMENT LIMITATION`, separate from this production email-verification token-refresh bug.

### QA cleanup and remaining lifecycle gap

- QA markers and the dedicated QA browser profile were retained temporarily to preserve evidence for the local fix and follow-up deployment validation. No unrelated production records were deleted.
- Required next step is deploy-authorized validation of the local token-refresh fix, then B-only persistence, B logout, Account A re-login, B→A isolation, conflict/update smoke, marker cleanup, and final Batch 7 classification.

### Batch 7 final production closure — 2026-08-25

- **Release:** `56f7c98` was pushed to `origin/main` and deployed as Vercel `dpl_FrvJw1LnqRrPDnkDiKqHVNSjgHiG` with READY status. The deployment SHA matched `56f7c9817cd5923ce0ed6fa0573c56dc875536a7`. `echo-learn.uk`, `app.echo-learn.uk`, and `echolearn-sepia.vercel.app` each returned HTTP 200.
- **Account B regression — PASS:** after loading the new bundle in the retained isolated QA profile, verified Account B showed `Last sync: Just now` with no permission error. Sanitized runtime evidence included `securetoken.googleapis.com/v1/token` HTTP 200 and Firestore Listen/Write channels HTTP 200. The previous `Missing or insufficient permissions` failure did not recur.
- **B persistence — PASS:** `ECHO_B7_ACCOUNT_B_ONLY_20260825` was created through the normal Vocabulary UI, remained visible after refresh, and was confirmed absent from Account A.
- **A→B isolation — PASS:** Account A marker was absent while B was authenticated; B began with zero local words after the account switch.
- **Logout B — PASS:** normal logout cleared B's device-scoped learning state. Re-entered Guest showed no A or B marker.
- **Account A restore — PASS:** Google Account A was selected in the standalone OAuth popup without a new credential entry. Account A cloud restore returned the A-only marker; the B-only marker remained absent. The A marker survived refresh.
- **B→A isolation — PASS:** the B-only marker did not appear after Account A restore.
- **Conflict/update smoke:** a production mark-mastered update was attempted on the A marker but the browser action did not produce a stable completion signal, so no production conflict claim is made. UpdatedAt and stale-cloud conflict behavior remain covered by deterministic tests only.
- **QA cleanup — PASS:** A-only, Guest, and B-only markers were deleted through normal Vocabulary UI. Refresh confirmed zero words; after final B logout, Guest Dashboard showed `0 Saved Words`, `0 Saved Sentences`, and `0 Study Sessions`. The temporary isolated QA profile remains available for evidence and was not deleted.
- **Known non-blocking runtime noise:** `proxy.echo-learn.uk/health` continued to report the documented CORS failure; it did not block Auth or Firestore lifecycle validation. No new Auth/Firestore defect was found after the token-refresh fix.

### Batch 7 final classification

**BATCH 7 COMPLETE.** Real production Google OAuth, email signup/verification, verified-token refresh, Firestore persistence, logout cleanup, A→B isolation, B→A restore/isolation, and marker cleanup passed in the dedicated isolated Chrome/CDP environment. Firebase Emulator remains future infrastructure, not a release blocker.

## Batch 8A — Email Verification Branding & Unverified Account Lifecycle — 2026-08-25

### Scope and external configuration result

- Baseline was `893968d` on `main`; no production data, project ID/number, OAuth client, secret, DNS record, or Firestore model was changed.
- Existing production evidence showed the default verification email branding as `project-820664709629` and a Firebase-hosted action-link domain. The intended branding target is the Firebase public-facing project/product name used by Authentication email templates; this must be changed in Firebase Console without renaming the project ID or number.
- Firebase Console inspection was attempted in the dedicated QA browser, but the signed-in identity received “the project does not exist, or you do not have permission to list the project’s apps” for `echolearn-9f369`. No Console setting was changed. A project-owner/admin takeover is required to apply and verify the branding change.
- `auth.echo-learn.uk` is already the application’s configured Auth domain for runtime Auth flows. Whether it is selectable as the verification email action-link domain was not confirmed because the Console was inaccessible; no DNS or OAuth change was attempted.
- No verification URL, `oobCode`, credential, token, cookie, or secret was recorded.

### Unverified-account policy from current implementation

| Capability | Unverified email account |
|---|---|
| Create account / login / resend verification | Allowed |
| Local vocabulary, sentences, study sessions, refresh persistence | Allowed |
| Auth-boundary cloud pull/push and Settings auto-sync | Denied until `emailVerified` is true |
| Settings “Sync Now” / “Upload Local” | Disabled until verified |
| Feedback | Disabled in UI and denied by Firestore rules |
| Logout / later login | Allowed |
| After verification | AuthContext force-refreshes the ID token, then starts cloud sync |

`firestore.rules` enforces verified email for `users/{uid}/data/*` and `feedback/*`. The existing `aiAnalyses/*` rule permits authenticated writes without an email-verification check; it was left unchanged because tightening that policy requires an explicit product/security decision.

### Bug found and fixed

- **Symptom:** an unverified user entering Settings triggered `syncWithCloud`, which failed with the expected `auth/email-not-verified` guard. Settings displayed a sync failure even though the user had not requested cloud sync, making the lifecycle appear broken or silently ineffective.
- **Root cause:** Settings auto-sync checked only `user?.uid`, unlike the verified-user guard used by the sync service and AuthContext.
- **Fix:** `shouldAutoSyncUser` now requires both a non-empty UID and `emailVerified`; the Settings effect also reacts to verification-state changes. Existing cloud/local data behavior and the independent `definitionEn` / `meaningCn` model were not changed.
- **Regression coverage:** added a focused test covering null/missing UID, unverified users, and verified users.

### Validation

- Vitest: `25` files / `328` tests PASS.
- TypeScript: `npx tsc -b` PASS.
- Lint: `npm run lint` PASS with `0` errors and `13` pre-existing hook/dependency warnings.
- Production build: `npm run build` PASS; Vite/PWA output generated successfully, with existing chunk-size warnings only.
- `git diff --check` PASS apart from normal Windows LF/CRLF warnings.
- No new production unverified-account lifecycle was run in this round because the branding Console permission blocker prevented a controlled new verification-email check. The already completed Batch 7 verified Account A/B evidence remains unchanged.

### Batch 8A classification

**PARTIAL — CODE FIX COMPLETE; FIREBASE BRANDING AND NEW UNVERIFIED PRODUCTION EMAIL CHECK BLOCKED BY CONSOLE ACCESS.** The local lifecycle guard and regression test are complete. Remaining external work is owner/admin Console access to update and verify the public-facing email branding, confirm the action-link domain choice, and rerun a disposable unverified-account lifecycle without exposing credentials or verification artifacts.

### Batch 8A follow-up — branding and disposable Email QA closure evidence — 2026-08-25

- **Firebase branding:** the user manually confirmed the Firebase public-facing project name as `EchoLearn`. The Firebase project ID, project number, Firebase app IDs, OAuth client IDs, Firestore IDs, Auth domain, and rules were not changed. The email template copy was intentionally left at the existing wording.
- **Actual `%APP_NAME%` source:** Playwright inspection of Google Auth Platform → Branding found the OAuth application name still set to `project-820664709629`; Firebase’s default `%APP_NAME%` therefore resolved to the project number even though the Firebase project name was `EchoLearn`. The user manually changed the OAuth application name to `EchoLearn`, and the Google Cloud page showed “brand changes saved.”
- **OAuth brand verification:** Google’s validation panel reports that `https://echo-learn.uk` is not registered as a domain owned by the current account. This blocks public OAuth consent-screen brand verification/display, but does not undo the saved application name. Domain ownership verification was not attempted in this round.
- **New verification email — PASS:** after the OAuth application-name change, the disposable QA account received a new email with subject `Verify your email for EchoLearn` and body/footer `Your EchoLearn team`. The old `project-820664709629` branding was absent. The action-link domain remained the Firebase-hosted domain `echolearn-9f369.firebaseapp.com`; no custom-domain change was attempted.
- **Sensitive-data boundary:** no password, verification URL, oobCode, API key, token, cookie, or credential was recorded in this report.

#### Disposable Email QA lifecycle

- The prior QA Email/Password Auth user was confirmed in the isolated browser as `Test2`, with UID `iZjkHYNCVgQfLEgjijlan4q48xC3`, verified status, and zero Vocabulary, Sentence, and Study Session records. It was deleted through Firebase Console only after exact email/UID confirmation. The email address was not deleted; no other Auth user or Firestore data was touched.
- Re-registration with the same QA email created a new UID and initially showed `Email not verified`. The isolated QA browser displayed the verification warning, disabled Sync Now and Upload Local, and blocked Feedback with an explanatory verification message.
- The first resend attempt showed the existing product failure message; a subsequent normal UI resend returned HTTP 200 from Firebase `accounts:sendOobCode` and displayed “Verification email sent.” No root-cause claim is made for the transient first failure.
- **Verification transition — PASS:** after manual email verification, the isolated browser showed `Email verified` after reload, Sync Now and Upload Local became enabled, `securetoken.googleapis.com/v1/token` returned HTTP 200, Firestore Listen/Write channels returned HTTP 200, and Settings showed `Last sync: Just now`. The previous `Missing or insufficient permissions` failure did not recur.
- Local Vocabulary/Sentence/Study creation was not completed in this follow-up; the QA account remained at zero records throughout, so no local persistence claim is made for those creation paths. The earlier production lifecycle and deterministic local coverage remain documented in Batch 6/7.

#### Policy matrix from code, rules, and observed QA UI

| Capability | Unverified Email | Verified Email |
|---|---|---|
| Login / account session | Allowed | Allowed |
| Local Vocabulary / Sentences / Study Sessions | Intended to remain local; no new marker created in this round | Available |
| Local refresh persistence | Covered by existing local-storage architecture/tests; not newly exercised with a marker here | Available |
| Personal Firestore sync | Denied by client guard and rules | Enabled after ID-token refresh |
| Manual Sync / Upload | Disabled in QA UI | Enabled in QA UI |
| Feedback | Blocked in UI and rules | Available |
| Resend verification | Available; one transient failure then HTTP 200 success | Not applicable |
| Logout / login | Allowed | Allowed |
| Post-verification transition | N/A | Verified; token refresh and cloud sync succeeded |

#### Remaining policy and environment decisions

- `aiAnalyses/{docId}` still permits authenticated writes without `email_verified == true`, unlike personal user data and feedback. This remains a documented **PRODUCT/SECURITY DECISION PENDING** exception; Firestore rules were not changed.
- The separate Google Cloud project `echolearn-0826` (Project Number `887740149577`) exists independently from Firebase project `echolearn-9f369` and was not modified or deleted. Firebase Console did not expose a Firebase app for it; ownership/purpose must be confirmed before any deletion decision.
- Production currently remains on `893968d`; the Settings auto-sync fix in local commit `4e1c6f1` was not deployed, so the old automatic `auth/email-not-verified` message observed before verification is not a local-fix production PASS. Automated tests remain authoritative for the fix until deployment.

#### Batch 8A updated classification

**READY FOR PUSH WITH DOCUMENTED EXTERNAL FOLLOW-UP.** The Firebase/OAuth user-facing email branding now passes on a newly generated email, the verified transition and cloud-sync unlock pass, and the Settings fix remains green locally. OAuth domain ownership verification and the separate `aiAnalyses` policy are documented follow-up decisions; neither was changed in this round. Local creation/persistence markers were not newly exercised and remain a known validation gap.

### Batch 8A final production closure — 2026-08-26

- **Release:** commits `4e1c6f1` and `832c3d4` were pushed to `origin/main`. Vercel deployment `dpl_55YNsioYS6hYwb6Ewar3jWmwgvz1` reached READY with Git SHA `832c3d4d67759751f87b7e8a634b06a3c3373565`. The production aliases `echo-learn.uk`, `app.echo-learn.uk`, and `echolearn-sepia.vercel.app` each returned HTTP 200.
- **QA reset:** the exact disposable Auth user was rechecked by project, email, and UID in Firebase Console, then deleted after confirmation. The Auth UID and email disappeared from Authentication → Users. The empty QA documents at `users/{uid}/data/vocabulary`, `sentences`, and `sessions` were confirmed to contain no learning items and were deleted. No other Auth user, Firestore UID, project setting, or main Chrome lifecycle state was changed.
- **New unverified signup — PASS:** the same dedicated QA email created a new Auth UID and the production Settings page showed `Email not verified`. Sync Now and Upload Local were disabled; Feedback was blocked with the verification explanation. A sanitized Settings network capture showed Identity Toolkit success but no Firestore Listen/Write requests.
- **Local pre-verification learning — PASS:** `creativity` was added through the normal Study UI, appeared as one Vocabulary item, survived navigation/refresh, and remained local. No Firestore request was observed during the local mutation.
- **Resend verification — PASS:** the normal Resend verification action completed and the UI displayed `Verification email sent. Check your inbox.`
- **Verified transition — PASS:** after the user manually verified the email, a fresh production Settings load showed `Email verified`, `Last sync: Just now`, and enabled Sync Now/Upload Local. Sanitized runtime evidence recorded `securetoken` HTTP 200, Firestore Listen HTTP 200, and Firestore Write HTTP 200 responses. The local vocabulary count remained 1 and the prior permission-denied failure did not recur.
- **Logout cleanup — PASS:** normal Sign Out returned to the logged-out Settings screen. Opening Vocabulary while logged out returned to the Guest/sign-in state and did not display the QA word, confirming device-scoped cleanup at the logout boundary.
- **Sensitive-data boundary:** no password, verification URL, oobCode, API key, token, cookie, or credential was recorded in this report.

### Batch 8A final classification

**BATCH 8A COMPLETE.** Code fix, email branding, unverified local-only behavior, resend flow, manual verification transition, forced token refresh, Firestore sync unlock, refresh persistence, logout cleanup, and QA data cleanup passed. OAuth domain ownership verification and the `aiAnalyses` verification-policy decision remain explicitly deferred and were not changed.

## Batch 9 — Data Integrity & Recovery — 2026-08-26

### Coverage map

| Area | Existing proof before Batch 9 | Batch 9 result | Safe validation boundary |
|---|---|---|---|
| Cross-device baseline | deterministic union/dedupe tests and earlier single-account lifecycle | **PASS** — Device A marker appeared on B; B marker appeared on A | dedicated verified QA account, two isolated profiles |
| Same-record conflict | deterministic `updatedAt` merge test | **PASS** — later B mutation won, one record remained | dedicated QA marker |
| Stale-device deletion resurrection | documented as a known gap; no tombstone coverage | **FAIL / ARCHITECTURE DECISION REQUIRED** | dedicated QA marker only |
| Offline failure and retry | mocked pull/push failure and pending-state tests | **TEST-ONLY PASS**; production offline/recovery smoke retained local data and recovered, but UI pending text was not independently exposed | QA CDP network emulation plus deterministic mocks |
| Partial collection failure | deterministic test existed | **TEST-ONLY PASS** — failed category was preserved and not uploaded as empty | mocked Firestore boundary |
| Concurrent sync | in-memory `syncInFlight` test existed | **TEST-ONLY PASS** — same-UID requests coalesced; no duplicate mock pull | mocked Firestore boundary |
| Account deletion | logout cleanup was covered; full deletion had no prior production evidence | **PASS** — Auth user removed, A/B returned Guest, all three user data subcollections had no documents | disposable QA account and Firebase Console read-only check |

### Two-device QA evidence

- Device A and Device B were separate Chrome profiles with local CDP ports `9224` and `9225`; the normal Chrome profile was not used for lifecycle data.
- Both devices were verified as the same dedicated QA Email/Password identity before data operations. No password, cookie, token, verification URL, or credential was recorded.
- `ECHO_B9_BASE_A` and `ECHO_B9_BASE_B` were created through the normal Vocabulary UI and synchronized in both directions.
- The same `creativity` record was changed to `ECHO_B9_CONFLICT_A` on A, then later to `ECHO_B9_CONFLICT_B` on B. After A refreshed, only the B value remained and there was one record. This matches the existing `updatedAt` merge semantics.

### Stale-device deletion resurrection — FAIL

Exact scenario:

1. Both devices contained the same QA record.
2. Device A deleted `ECHO_B9_CONFLICT_B` through normal Vocabulary UI and successfully pushed the shorter array.
3. Device A no longer displayed the marker.
4. Device B retained its stale local copy and then refreshed/synchronized.
5. Device B displayed `ECHO_B9_CONFLICT_B` again; sanitized Firestore Listen/Write responses were HTTP 200.

Root cause: the current collection format is a full item array and `mergeById(local, cloud)` treats every item missing from cloud as a local-only item. A stale local item therefore re-enters the merged array and is uploaded again. There is no deletion event, `deletedAt`, tombstone, per-item cloud document, or collection revision that can distinguish “deleted” from “not present in this snapshot.”

This requires **ARCHITECTURE / DATA MODEL DECISION REQUIRED**. Minimal options are:

1. Add per-item tombstones (`deletedAt` plus item identity) and merge deletions before live items, with a later retention/garbage-collection policy.
2. Store a per-user change log or collection revision containing additions, updates, and deletions, then compact only after all devices have advanced past the deletion.
3. Migrate from full-array documents to per-item documents with explicit delete operations and a bounded device/version strategy.

No tombstone or schema redesign was implemented in Batch 9.

### Offline, partial-failure, and concurrency evidence

- QA CDP network emulation interrupted a local mutation. The local vocabulary remained available, the recovered online sync completed, and Settings later showed `Last sync: Just now` with the QA data count retained. No production infrastructure or network setting was changed.
- Existing deterministic tests passed for all-pull failure, partial category failure, failed lightweight push, retry marker state, and prevention of false successful last-sync timestamps.
- Existing deterministic concurrency coverage passed: simultaneous `syncWithCloud('user-a')` calls returned the same in-flight Promise and performed one three-category pull. Cross-tab locking remains unimplemented and was not treated as a demonstrated defect.

### Account deletion lifecycle — PASS

- The disposable QA account contained only Batch 9 QA data before deletion. The first normal UI attempt correctly required recent login; after the user completed a normal re-login, the second normal UI deletion succeeded.
- Device A returned to logged-out Guest state. Device B, after reload, also returned to logged-out Guest state and did not retain visible QA vocabulary.
- Firebase Console read-only verification confirmed the QA Auth UID/email no longer appeared in Authentication → Users.
- Firebase Console read-only verification showed no documents in `users/{uid}/data/vocabulary`, `sentences`, or `sessions`.
- No other Auth user or Firestore UID was changed, and the QA mailbox was not deleted.

### Batch 9 classification

**BATCH 9 ARCHITECTURE DECISION REQUIRED.** All production-safe scenarios that do not require deletion protocol redesign passed or were covered by deterministic tests. The demonstrated stale-device deletion resurrection defect remains unresolved and cannot be safely fixed without choosing a tombstone/change-log/per-item deletion model.

## Batch 9B — Production Tombstone Validation — 2026-08-26

### Browser method and release revision

- Used two fresh, independent Chrome profiles with localhost-only CDP ports `9226` (Device A) and `9227` (Device B). The normal Chrome profile was not used for learning-data lifecycle operations.
- Both isolated devices used the same dedicated verified QA identity. No password, cookie, token, verification code, or credential body was inspected or recorded.
- Tested production revision: `f65a0a9`, deployment `dpl_D7Bor4UDC5z15uxLay8Adj1gFemp`, state **READY**, aliases `echo-learn.uk`, `app.echo-learn.uk`, and `echolearn-sepia.vercel.app`.

### Vocabulary stale-device gate — PASS

- A created and synchronized a vocabulary record through the normal Study transcript UI; B received it.
- A deleted it through the normal Vocabulary UI and synchronized the deletion.
- B retained its stale local copy, then synchronized using the new deployed revision.
- B removed the stale record; A and B both showed `0 words`. No resurrection was observed after another reload/sync.
- The original Batch 9 failure is therefore resolved by the existing tombstone protocol in production.

### Sentence deletion smoke — PASS

- A created a sentence through the normal transcript bookmark UI, synchronized it to B, deleted it through the normal Sentence UI, and synchronized.
- B converged to `0 sentences`; the sentence did not return after refresh.

### Study Session deletion smoke — initial defect and fix

- Before the fix, A deleted a session through Dashboard, but B's stale session returned after synchronization. The exact root cause was that Dashboard's single and batch delete handlers called local `deleteSession()` without calling `pushSessionToCloud()`.
- Targeted fix: Dashboard now invokes the existing session upload helper after both single and batch deletion paths. No Firestore schema or tombstone protocol redesign was made.
- Regression test added for authenticated session-deletion push and Guest no-op behavior.
- After deployment, the previously stale B session was synchronized again and disappeared; Dashboard showed `0 total` sessions. Current-session cleanup remains handled by the existing `deleteSession()` path.

### Batch deletion coverage

- Dashboard single-session deletion was production-tested.
- The batch-delete handler was code-reviewed against the same shared helper and covered by the targeted regression path; a separate multi-select production run was not needed after the single-delete defect was isolated and fixed.

### Offline stale-device variant

- B was placed offline with CDP network emulation while retaining a stale vocabulary record. The offline attempt did not claim a new successful sync or alter the stale local record.
- After restoring the network and loading the current deployment resources, A's synchronized tombstone removed the stale B record; final B state was `0 words`.
- Deterministic tests remain the stronger evidence for exact pending-marker and false-last-sync semantics; no new offline UI defect was found.

### Runtime and serialization evidence

- Production UI reported successful sync completion and zero active records after convergence. Firestore-backed operations completed without a visible error.
- Deterministic sync coverage confirms the serialized collection shape includes active `items`, `tombstones`, `updatedAt`, and `serverUpdatedAt`, and accepts legacy documents with missing `tombstones` as `{}`.
- QA created only disposable test records/tombstones. Tombstone retention/garbage collection was not changed and remains deferred.

### QA cleanup and classification

- Active QA vocabulary, sentence, and session records were removed through the normal UI. Both isolated devices ended with no visible QA learning records.
- No unrelated user data was touched. Retained QA tombstones are harmless test-account artifacts; cleanup/GC policy is deferred to a future task.
- **BATCH 9 COMPLETE.** Production Vocabulary, Sentence, and Session deletion paths now preserve deletions across stale-device synchronization. The only implementation defect found in Batch 9B was the missing Dashboard session push, and it was fixed, regression-tested, deployed, and re-tested.

## Batch 10 — Firebase Emulator + CI Regression Gates — 2026-08-26

### Scope and architecture

- Added a local Firestore Emulator gate using the isolated project id `echolearn-emulator`; it does not connect to production Firestore and does not require production credentials.
- Emulator configuration enables only Firestore on port `8080`; Auth, Functions, Hosting, and production Firebase settings were not changed.
- The local wrapper keeps Firebase CLI configuration under a temporary task-specific directory so the normal user profile is not modified.
- `firebase-tools` is pinned to `13.35.1` because the available Java 17 runtime is supported by this version; the newer CLI required Java 21.

### Emulator coverage

- Rules: unauthenticated and unverified access is denied for personal data; verified owners can read/write their own data; cross-user access is denied.
- Rules: the current `aiAnalyses` policy is captured as a regression test and explicitly not changed in this task.
- Rules: verified feedback creation succeeds with a server timestamp; unverified feedback creation is denied.
- Firestore integration: vocabulary, sentences, and sessions round-trip with active items, tombstones, and timestamps; legacy documents without tombstones are accepted; stale-device and updatedAt conflict merges are covered; empty collections do not overwrite another collection; own-document deletion and cross-user deletion boundaries are covered.

### CI and commands

- `npm run test:emulator` starts the Firestore Emulator, runs the isolated 10-test suite, and shuts the Emulator down.
- `npm run test:ci` runs unit tests, TypeScript build checking, lint, production build, and the Emulator gate.
- GitHub Actions now installs Java 17 and runs the Emulator gate after the existing unit/build/lint steps. Existing npm caching and Playwright E2E job remain unchanged.

### Validation

- `npm test`: PASS, 26 files / 340 tests.
- `npm run test:emulator`: PASS twice, 1 file / 10 tests each run; both Emulator start/stop cycles completed successfully.
- The CI workflow was updated locally but was not executed remotely because this task is not pushed.

### Boundaries and classification

- No production Firestore/Auth data, production rules, AI analysis policy, application data model, or credentials were changed.
- Live production lifecycle, browser E2E, and remote GitHub Actions results are outside this local Emulator task and remain separately evidenced by prior batches.
- **BATCH 10 READY FOR PUSH.** Full local CI-equivalent validation passed; remote CI and push remain intentionally pending authorization.

### Batch 10 remote closure — 2026-08-26

- Commit `3d366360e03880be6da9f5ee915ea17035217cb9` was pushed to `origin/main` without force-push; no unrelated branch was changed.
- GitHub Actions workflow `CI` run `32955080027` was triggered by `push` on Ubuntu. The `test` job passed in 1m12s and the `e2e` job passed in 1m39s.
- Remote `test` steps passed: `npm ci`, unit tests (340), build, lint (0 errors; existing warnings), Java 17 setup, and Firestore Emulator tests (10/10). The remote Emulator used the isolated `echolearn-emulator` project and required no production credentials.
- Remote `e2e` steps passed: Playwright browser installation and `npm run e2e`.
- GitHub Actions annotations contain existing warnings only: action Node 20/setup-java v4 deprecation notices and the pre-existing React Hook lint warnings. No CI-specific fix was required.
- GitHub deployment record `6101278070` for this SHA was created by `vercel[bot]` and reported `success`; its production target was `https://echolearn-6hxzv99h7-shmily0826s-projects.vercel.app`. `https://echo-learn.uk` returned HTTP 200. The Vercel CLI was unavailable locally, so deployment success was verified through the GitHub deployment status and HTTP health check.

### Batch 10 final classification

**BATCH 10 COMPLETE.** Implementation, remote CI, Emulator gate, Playwright E2E, production isolation, deployment status, and TEST_REPORT closure are complete; this entry is recorded in the final documentation-only commit.

## Batch 11 — Mobile / PWA Lifecycle — 2026-08-26

### Coverage matrix

| Area | Result | Evidence |
|---|---|---|
| Existing desktop Chromium | PASS | 11 existing E2E tests passed in the final 19-test run |
| Mobile Chromium | PASS / EMULATED | Pixel 5 profile; 4 tests passed in each of two runs |
| Mobile WebKit | PASS / EMULATED | iPhone 12 profile; 4 tests passed in each of two runs; not physical iOS Safari |
| Android real device | NOT AVAILABLE | No accessible Android/ADB device in this run |
| Physical iOS Safari | NOT AVAILABLE | Windows Playwright cannot provide physical iOS Safari evidence |
| Responsive overflow | PASS | Dashboard, Vocabulary, Sentences, Review, Settings and Study checked at mobile viewport |
| Long-content stress | NOT COVERED | No deterministic long-content fixture was required by the observed paths |
| Study transcript/media UI | PASS / EMULATED | Sample transcript visible on mobile; existing desktop media-sync tests remain green |
| Background/foreground | PASS / DETERMINISTIC | visibilitychange/pageshow lifecycle events preserve transcript and layout; OS suspension not emulated |
| Background during loading | NOT COVERED | No delayed transcript fixture was needed after no lifecycle defect was observed |
| Offline/reconnect | PASS / EMULATED | Loaded Guest shell remains usable offline; Study works after reconnect |
| Orientation | PASS / EMULATED | Portrait → landscape → portrait retains Study transcript and no overflow |
| PWA manifest | PASS | Production build manifest has standalone display, `/` scope/start URL, metadata and valid icons |
| Service worker | PASS / PRODUCTION PREVIEW | Generated SW registered with active scope `/` in local production preview |
| Standalone mode | PASS / CONFIGURATION | Manifest declares `display: standalone`; full installed-PWA OS chrome not available |
| Update lifecycle | NOT COVERED | No old/new service-worker deployment fixture was necessary |
| Touch targets/keyboard | NOT COVERED | No clear target/input defect was demonstrated in this bounded pass |

### Implementation and regression coverage

- Added `mobile-chromium` and `mobile-webkit` Playwright projects while preserving the existing desktop project.
- Added `npm run e2e:mobile`; the normal `npm run e2e` now runs desktop Chromium plus the bounded mobile Chromium/WebKit suite.
- Added reusable horizontal-overflow assertions and console/page-error checks for the mobile route smoke.
- Added mobile navigation coverage for Dashboard, Vocabulary, Sentences, Review, Settings, and Study; Study transcript visibility after orientation/lifecycle events; offline/reconnect; manifest metadata and icon checks.
- CI now builds before E2E and installs both Chromium and WebKit. The existing CI Emulator gate remains unchanged.
- The only initial failures were test-harness issues: direct `page.goto` reset Guest React state, dev Vite does not serve the production manifest, WebKit was not installed locally, and Settings health probes produced expected localhost CORS noise. These were fixed in the test harness with in-app navigation, build-artifact checks, WebKit installation/CI setup, and a deterministic health fixture. No product defect was found.

### Validation

- `npm run e2e:mobile`: PASS twice — 8/8 each run (4 mobile Chromium, 4 mobile WebKit).
- `npm run e2e`: PASS — 19/19 (11 desktop Chromium, 4 mobile Chromium, 4 mobile WebKit).
- Production preview check: manifest delivered as JSON; service worker registered active with scope `/`.
- `npm test`: PASS — 340 tests.
- `npm run test:emulator`: PASS — 10/10.
- `npx tsc -b`: PASS.
- `npm run lint`: PASS — 0 errors, 13 existing warnings.
- `npm run build`: PASS; PWA generated `dist/sw.js` and manifest.
- `git diff --check`: PASS.

### Production and device boundaries

- No production Auth/Firestore lifecycle was repeated and no production data was modified.
- No real Android device or physical iOS Safari was available; Pixel 5 Chromium and iPhone 12 WebKit are browser approximations.
- The existing live-provider uncached 1–2 minute path, forced provider outages, `aiAnalyses` policy, tombstone GC, OAuth/Search Console, custom verification domain, and existing lint/action deprecation warnings remain deferred.
- **BATCH 11 READY FOR COMMIT.**

### Batch 11 remote closure — 2026-08-26

- Implementation commit `d20b24f63c6a64596945803c4e2f27f67dd2e780` was pushed to `origin/main` without force-push or unrelated branch changes.
- GitHub Actions run `32965567329` passed on Ubuntu: test job 59s and E2E job 2m22s. The remote E2E run passed 19/19, including desktop Chromium, mobile Chromium, and mobile WebKit; the test job passed unit 340, build, lint, Java 17, and Emulator 10/10.
- Vercel deployment `6103164932` for the implementation SHA reported success; production target was `https://echolearn-ixrre1gn6-shmily0826s-projects.vercel.app`, and `https://echo-learn.uk` returned HTTP 200.
- No CI-specific product fix was required. The final docs-only closure commit is recorded separately after this section.

### Batch 11 final classification

**BATCH 11 COMPLETE.** Responsive mobile coverage, WebKit approximation, PWA artifact/preview checks, visibility/orientation, offline/reconnect smoke, CI, deployment, and production HTTP health all passed. Physical Android and iOS device validation remain explicitly unavailable rather than being conflated with browser emulation.

## Batch 12 — Real Uncached Provider Lifecycle — 2026-08-27

### Repository sync

- Local `main` and `origin/main` both started at `8f5de3ba75ad2233457326553c54ea5d6541babe`; ahead/behind was `0/0` and the worktree was clean.
- Prior provider and Study failure-recovery evidence was preserved. The original 63-second uncached race, stale `fetchToast`, and `Zq8e3xX02u8` official-caption incident remain already-known historical items, not new findings.

### Current timeout architecture

```text
Browser Study request
  -> local proxy (4s, skipped for 5 min after failure)
  -> official InnerTube / page caption paths
  -> CF Worker /api/transcript
       -> VPS yt-dlp transcript (90s Worker cap)
       -> VPS ASR/Whisper (240s Worker-side fetch cap)
       -> Worker-side providers / Whisper fallbacks
  -> same-origin Vercel /api/transcript
       -> VPS transcript fetch (45s Vercel function AbortController cap)
       -> youtube-transcript package fallback
```

- The frontend server cascade uses a 120-second timeout per endpoint. The Worker’s VPS transcript/ASR calls allow longer work, but the browser can abandon the Worker before those calls return.
- The Vercel transcript function currently aborts its VPS request after 45 seconds. Its fallback to `youtube-transcript` is only reached after that VPS attempt returns or aborts.
- The VPS ASR route has a default 30-minute media-duration limit and a default 180-second Groq timeout; these are service-side limits, while the Worker/Vercel/browser limits above determine whether a synchronous browser request can observe the result.
- No timeout was changed in Batch 12. The evidence is sufficient to identify a possible client/server timeout mismatch, but not sufficient to justify an async-job architecture or a speculative timeout change.

### Existing coverage and new controlled coverage

- Existing hook tests already cover delayed success, stale late failure, latest-request-wins, toast reset, and elapsed loading state.
- Existing Study E2E already covered immediate 500 → error → Retry → success.
- Added two page-level controlled lifecycle tests to `e2e/study-failure-recovery.spec.ts`: delayed success stays loading and then renders without refresh; delayed failure clears loading and Retry succeeds. Both passed.

### Real candidate and first load

- Candidate: `uPRSigrDt0Q`, public English speech, 230 seconds (about 3:50), selected from current YouTube search results.
- YouTube player metadata exposed no caption tracks. A shorter 8-second Shorts candidate was rejected as unsuitable before any EchoLearn request.
- The isolated Guest browser submitted the candidate once. At about 29 seconds the Worker transcript request was visible; after the 120-second client budget the same-origin Vercel request was visible. The page remained in one coherent loading state throughout the slow path.
- The first load ended after roughly 233 seconds with the Load button idle, loading cleared, no transcript, and one visible error card with Retry. The captured Vercel response was HTTP 500 with the sanitized body `Transcript is disabled on this video (uPRSigrDt0Q)`.
- No refresh was used during the initial attempt. No success toast, transcript, or contradictory loading/error combination appeared.

### 120-second boundary, retry, and cache transition

- Reaching the 120-second boundary: **YES**. The Worker request did not produce a browser-visible success response in the observed window; the browser proceeded to Vercel. A bounded 45-second post-failure observation found no later Worker response or cache-hit event.
- One controlled Retry was performed only after the first request had fully failed. It again used one Worker request followed by one Vercel request and ended with the same HTTP 500 disabled-caption response. No overlapping requests were observed.
- A successful ASR generation and cache transition could not be established for this candidate. Therefore no repeat-load latency or cached transcript identity is claimed.
- The candidate reached the uncached/no-caption server path, but the production evidence does not prove that Whisper completed; it cannot be recorded as a successful real ASR fixture.

### Worker → Vercel fallback

- The real production request exercised the deployed Worker-first then same-origin Vercel fallback naturally; no Worker outage was manufactured and no production infrastructure was changed.
- A separate interception-only fallback test was not repeated because it would add another production provider request without improving the already-observed fallback evidence.

### Bugs / architecture findings

- No bounded frontend lifecycle bug was found. The UI correctly showed one loading state, cleared it on failure, exposed Retry, and did not display stale success state.
- The remaining finding is an **architecture-level risk / incomplete evidence**, not a targeted fix: a realistic no-caption request can outlive the browser’s 120-second Worker wait, while the Vercel path independently aborts VPS work at 45 seconds. The observed candidate then surfaced a truthful provider error rather than a false frontend success/failure race.
- Per task scope, no synchronous-to-async job redesign was started. A future change would require an explicit architecture decision and provider-side evidence showing that ASR actually completes after the downstream request is abandoned.

### Validation

- Controlled Study lifecycle E2E: **PASS — 2/2**.
- Full Playwright E2E: **PASS — 21/21** (desktop Chromium, mobile Chromium, mobile WebKit).
- `npm test`: **PASS — 340/340**.
- `npm run test:emulator`: **PASS — 10/10**.
- `npx tsc -b`: **PASS**.
- `npm run lint`: **PASS — 0 errors, 13 existing warnings**.
- `npm run build`: **PASS**.
- `git diff --check`: **PASS**.
- Production real-provider evidence: **PARTIAL**; one true uncached/no-caption candidate was observed, but no successful Whisper completion or cache transition was proven.

### Batch 12 final classification

**BATCH 12 PARTIAL.** Controlled slow lifecycle coverage is complete and the real production request/fallback/error behavior is recorded. The high-value successful uncached Whisper lifecycle and cache transition remain unproven because the selected candidate returned a definitive disabled-caption error after the synchronous fallback chain; no product code or timeout was changed.

## Batch 12B — ASR Trace + Final Uncached Validation — 2026-08-27

### Commit and sync

- The previously validated Batch 12 test/report changes were committed locally as `3abfb00a5ddef39aab404c30479b3960d51f4f52` (`test: cover slow transcript lifecycle`).
- `origin/main` remains at `8f5de3ba75ad2233457326553c54ea5d6541babe`; local `main` is ahead by one. No push was performed.
- Final working tree is clean after the report update below is committed separately.

### `uPRSigrDt0Q` trace

Evidence levels are kept explicit: browser request events are **PRODUCTION REAL PROVIDER** evidence; source/config conclusions are **CODE INSPECTION**; missing backend logs are **NOT OBSERVABLE**.

- Browser: `uPRSigrDt0Q` entered the production server cascade after local proxy and official caption paths did not produce a transcript. The isolated browser remained in one loading state, crossed the 120-second Worker wait, then requested same-origin Vercel `/api/transcript`.
- Worker: a Worker `/api/transcript?videoId=uPRSigrDt0Q&lang=en` request was observed, but no browser-visible Worker response was captured during the bounded post-failure observation. Whether the Worker received the request and whether it continued after the browser abandoned it is **NOT OBSERVABLE** without retained Worker logs.
- VPS/Groq: public health reported `asr:true` and `asrMaxDuration:1800`, proving production ASR configuration is present. No retained VPS access log, yt-dlp log, audio extraction log, Groq request log, or ASR cache-write log was available for the historical request. ASR invocation is therefore **NOT OBSERVABLE**, not proven absent.
- Vercel: the fallback request returned HTTP 500. `api/transcript.ts` catches a failed/empty VPS result and then calls `youtube-transcript`; the exact returned body matched that package’s thrown `Transcript is disabled on this video (uPRSigrDt0Q)` error. The body does not prove that the earlier VPS attempt never ran, because `fetchVpsTranscript` intentionally collapses VPS non-2xx, timeout, and network failures to `null`.
- Cache: no Worker response or cache-hit signal was captured after the browser failure. VPS source code caches only successful transcript/ASR results in memory; no historical cache-write evidence is available.

### Provider decision tree from current code

```text
Browser
  1. local proxy (4s; skip for 5 min after failure)
  2. InnerTube ANDROID -> WEB, then timed-text parsing
  3. YouTube page extraction, then timed-text parsing
  4. CF Worker transcript (120s browser wait)
       VPS /api/transcript (Worker 90s fetch cap)
       if no result: VPS /api/asr (Worker 240s fetch cap, when configured)
       if no result: Worker InnerTube -> page -> Worker Whisper -> Invidious -> Piped
  5. same-origin Vercel /api/transcript (120s browser wait)
       VPS /api/transcript (45s AbortController cap)
       if no result: youtube-transcript package
  6. client-side youtube-transcript package fallback
```

- A successful transcript requires a non-empty `lines` array. A successful VPS ASR result is returned with `source:"asr"` and is cached by the VPS under its ASR-specific key.
- VPS `/api/transcript` and `/api/asr` use separate cache keys. The transcript route does not itself call ASR; the Worker explicitly calls ASR after its VPS transcript attempt fails.
- The VPS has a successful-result TTL cache but no transcript/ASR in-flight lock. The only in-flight lock found is for playback audio extraction, not transcript generation.
- The browser’s promise map coalesces simultaneous frontend calls for the same video/language within one page, but it cannot deduplicate a new endpoint request after the first request is aborted or after a Retry starts.
- Therefore, if Worker/VPS work continues after the browser’s 120-second abort, a later Vercel request or Retry can start independent VPS/ASR work unless the first request has already populated the success cache. Duplicate expensive ASR work is a code-level risk, not observed as a confirmed event in this run.

### ASR readiness

`NOT OBSERVABLE`

- **Configured:** VPS health returned `asr:true` and the default 1800-second duration ceiling.
- **Reachability of route:** Worker code conditionally calls VPS ASR when `YTDLP_API_URL` and `GROQ_API_KEY` are configured; health proves the VPS has Groq configuration, but does not prove the Worker secret/config binding or a historical invocation.
- **Historical invocation:** no retained Worker/VPS/Groq logs were available for `uPRSigrDt0Q`.
- Two well-selected no-caption production candidates reached the slow server path but both ended in the Vercel `youtube-transcript` disabled-caption error; no third candidate was attempted.

### Final candidate

- Executed: yes, exactly once.
- Video: `ImMoFcCo1M0`
- Title: `World Youth Skills Day Speech 2026 | Best English Speech for Students | School Assembly Speech`
- Duration: 195 seconds
- YouTube metadata: no caption tracks; public, non-live, non-Shorts English speech.
- Result: loading remained coherent through about 141 seconds; final state was idle Load button, no transcript, one Retry error card, HTTP 500 from Vercel with `Transcript is disabled on this video (ImMoFcCo1M0)`.
- No refresh and no Retry were performed for this final candidate.

### Real uncached lifecycle and cache transition

- ASR start: **NOT OBSERVABLE**.
- First-load latency: approximately 198 seconds from submit to final Vercel error.
- 120-second boundary: **YES**; Worker request was followed by Vercel fallback.
- Transcript result: none.
- Refresh required: not applicable; the first request failed and was not retried.
- UI coherence: PASS; loading cleared, Load returned idle, Retry was available, and no stale success state appeared.
- Cache transition: **NOT EXECUTED / NOT PROVEN**. No successful ASR result existed to repeat-load, and no cache-hit evidence was observed.

### Bugs / architecture findings

- No bounded frontend bug was found. Controlled delayed success/failure tests and both real production attempts showed correct loading/error/Retry state handling.
- The principal finding is evidence and architecture risk, not a confirmed ASR provider defect: the synchronous chain permits the browser to abandon a Worker request before a potentially long VPS/ASR operation completes; Vercel separately aborts VPS transcript work after 45 seconds.
- The current code has no transcript/ASR server-side in-flight deduplication. A post-abort Retry or Worker→Vercel fallback could duplicate expensive generation before a successful result reaches the VPS cache.
- No broad async-job redesign or speculative timeout change was made. Any reliable late-completion handling requires an explicit architecture decision.

### Validation

- Prior controlled lifecycle E2E: PASS — 2/2.
- Prior full Playwright: PASS — 21/21.
- Prior unit: PASS — 340/340.
- Prior Emulator: PASS — 10/10.
- Prior TypeScript, lint, build, and diff checks: PASS; lint had 0 errors and 13 existing warnings.
- Commit verification: local commit created successfully; no push.

### Batch 12B final classification

**BATCH 12 PARTIAL.** Production ASR is configured, but historical Worker/VPS/Groq logs are unavailable, so neither candidate can prove ASR invocation or cache completion. The controlled lifecycle coverage and exact provider decision tree are documented; no bounded product fix was justified.

## Batch 12C — safe provider observability and final probe (2026-08-27)

### Scope and result

Batch 12C added safe correlation only. Provider order, timeout budgets, response shapes, credentials, and browser behavior were not redesigned. The Cloudflare Worker was deployed as version `82f56538-b474-41b7-b560-c9ab168d65d4`; the Vercel layer was deployed by the push of commit `bbb15f3`.

- Vercel now creates `X-EchoLearn-Trace-Id`, forwards it to the VPS, exposes it in the response, and emits structured provider outcome events without logging keys, cookies, authorization headers, or response bodies.
- Cloudflare Worker now creates/returns the same bounded trace id, forwards it to VPS transcript/ASR calls, and emits provider start/result/finish events. Debug payloads remain disabled by default.
- VPS now accepts only a bounded safe trace-id format, returns it on transcript/ASR responses, and emits request status, duration, and success/failure outcome events. No VPS deployment was performed because this checkout has no SSH/host deployment mechanism or accessible VPS log reader.

### Final uncached production probe

- Candidate: `uPRSigrDt0Q` (the previously selected public no-caption candidate).
- Worker request: completed with HTTP 404 and body `{"error":"No transcript available for this video"}`.
- Worker trace: `112615fb-469d-4b2b-9f37-87b392f82db5`.
- Response headers included `X-EchoLearn-Trace-Id` and `Access-Control-Expose-Headers`.
- A second probe while attempting to attach `wrangler tail` was reset by the Worker at roughly the 90-second backend boundary; the tail connection also lost its keep-alive and could not reconnect. No historical Worker/VPS/Groq logs were available after the request, so ASR invocation, Groq response, and ASR cache write remain **NOT OBSERVABLE**.
- The Vercel deployment was independently checked with a missing-parameter request: HTTP 400 with a valid trace header. GitHub CI run `32971914574` passed all test, E2E, emulator, build, and lint jobs.

### Tests and limitations

- Targeted transcript handler regression: PASS — 5/5, including trace propagation, server-side key isolation, VPS non-2xx fallback, timeout fallback, and no-key behavior.
- TypeScript build check: PASS — `npx tsc -b`.
- Targeted lint: PASS — `npx eslint api/transcript.ts src/api/__tests__/transcriptHandler.test.ts`.
- Cloudflare Worker syntax: PASS — `node --check cf-worker/src/index.js`.
- VPS Python compile check: **NOT RUN** because the local environment has no `python` executable; no claim is made for that check.
- The final no-caption probe did not produce a transcript, so successful ASR, repeat-load cache hit, card-level transcript rendering, and late-completion deduplication remain unproven.

### Batch 12C final classification

**BATCH 12 INFRASTRUCTURE BLOCKED.** Safe observability is deployed at the Worker and Vercel layers, and CI is green, but the VPS source was not deployed from this checkout and production Worker/VPS/Groq logs cannot be retained or read through the available access. The final probe still returns no transcript; therefore Batch 12 cannot be classified complete and no speculative provider or timeout redesign was made.

## Batch 12D — AWS VPS verification and traced production probe (2026-08-27)

### AWS host and source verification

- The existing PEM fingerprint matched the task-provided fingerprint. A bounded SSH probe to `ubuntu@3.107.69.57` succeeded.
- Host evidence matched EchoLearn: user `ubuntu`, hostname `ip-172-31-11-241`, `echolearn-ytdlp.service` active, WorkingDirectory `/opt/echolearn-ytdlp`, uvicorn `main:app`, and health endpoint available.
- The actual production listener is port 80, not the historical port 8000. `/api/health` returned `{"status":"ok","asr":true,"asrMaxDuration":1800}` before and after deployment.
- The remote `main.py` differed from the tracked source only by the expected 42-line tracing middleware block; no unrelated production-only source divergence was found.

### Deployment and trace validation

- Created the rollback backup `/opt/echolearn-ytdlp/main.py.bak-20260827-014953` before replacement.
- Uploaded the tracked `vps-ytdlp/main.py`, passed the service-venv Python syntax check, restarted `echolearn-ytdlp.service`, and verified it remained active with a passing health response.
- A cheap request returned `X-EchoLearn-Trace-Id: batch12d-cheap` and produced a matching safe `request_finish` journal event. The event contained only service, event, traceId, path, status, elapsedMs, and outcome; no credential values were read or logged.

### Final real production probe

- Candidate: `uPRSigrDt0Q`, executed once in the isolated Codex QA browser without refresh or Retry.
- Browser state: loading remained coherent for approximately 186 seconds, then cleared to the existing “Unable to fetch captions” failure state with 0 subtitles and Retry available.
- VPS evidence for the same observation window: `/api/transcript` request finished with HTTP 404 after `64695ms`. A preceding VPS transcript request finished with HTTP 404 after `12330ms`.
- No VPS `/api/asr` `request_finish` event was observed in the bounded journal query. Worker-side trace logs, Groq request/result logs, media extraction details, ffmpeg details, and cache-write details are not available through the current access surface. Therefore ASR invocation, Groq outcome, ASR parsing, cache transition, late completion, and duplicate ASR work remain **NOT OBSERVABLE**.
- The current Worker source conditionally enters the VPS ASR branch only when both `YTDLP_API_URL` and `GROQ_API_KEY` are configured. The observed absence of a VPS ASR event is consistent with the branch not being entered, but production Worker configuration/log evidence is required before calling that the root cause.

### Findings and classification

- AWS host identity, SSH access, production source parity, reversible deployment, VPS tracing middleware, service health, and transcript-stage failure were confirmed.
- No bounded application code defect was proven. The remaining blocker is production observability/configuration evidence for the Worker-to-VPS-ASR/Groq path; changing timeout or provider logic without that evidence would be speculative.
- Existing credentials and service configuration were not changed. No duplicate ASR request was confirmed.

### Batch 12D final classification

**BATCH 12 INFRASTRUCTURE DECISION REQUIRED.** The confirmed production VPS is healthy and now runs the tracked tracing source, but the no-caption probe still ends at transcript HTTP 404 with no observable VPS ASR invocation. A production Worker configuration/logging decision is required to determine whether the ASR branch is enabled and why it did not produce a traceable result; successful uncached ASR and cache-hit closure cannot be claimed.

## Batch 12E — VPS ASR gate hypothesis verification (2026-08-27)

### Dependency and configuration result

- `fetchViaVpsAsr()` uses `YTDLP_API_URL` to construct `/api/asr`, optionally forwards `YTDLP_API_KEY`, and forwards the trace ID. It does not call Groq directly and does not consume Worker `GROQ_API_KEY`.
- `fetchViaWhisper()` is the separate Worker-direct Groq path and continues to require Worker `GROQ_API_KEY`.
- The Cloudflare Worker secret-name listing contained `YTDLP_API_URL`, `YTDLP_API_KEY`, and `GROQ_API_KEY`. Secret values were not read.
- The current Worker deployment remained version `82f56538-b474-41b7-b560-c9ab168d65d4`.

### Gate hypothesis decision

- Hypothesis rejected. The Worker `GROQ_API_KEY` gate was not the cause of the observed skipped-ASR behavior; the production Worker had the secret binding and the subsequent controlled trace proved that the VPS ASR branch was entered.
- No source change was made to the gate. The VPS ASR gate remains coupled only to the dependency it actually needs for the call, `YTDLP_API_URL`; the Worker-direct Whisper gate remains unchanged.

### Same-fixture production trace

- The same `uPRSigrDt0Q` fixture was requested once directly through the deployed Worker while a narrowly filtered Worker tail was active.
- Trace ID: `f4cc9f91-14ed-4730-b5d2-8e7448d96f50`.
- Worker events: `request_start` → `vps_transcript_start` → VPS transcript HTTP 404 → `vps_asr_start` → `vps_asr_result` HTTP 524 / unusable → remaining provider cascade → `request_finish` HTTP 404 with provider `none`.
- VPS tracing recorded the transcript request finishing HTTP 404 after `24935ms`; no corresponding VPS `/api/asr` `request_finish` event appeared for the exact trace during the observation window. This is consistent with the Worker-facing upstream 524 occurring while the synchronous ASR operation exceeded the reachable request boundary.
- Worker response was HTTP 404 with `{"error":"No transcript available for this video"}` and a matching `X-EchoLearn-Trace-Id`. No successful ASR transcript or cache transition occurred.
- The direct Worker probe did not create a Vercel fallback request, so duplicate ASR work was not introduced by that probe. No duplicate Groq call was confirmed.

### Final finding

- The gate defect is not confirmed and was not patched. ASR is reachable from the Worker, but the synchronous VPS ASR request returns HTTP 524 before producing a result. Resolving the request-duration/upstream boundary requires an infrastructure or asynchronous-job decision; changing the Worker secret gate would not address it.

### Batch 12E final classification

**BATCH 12 INFRASTRUCTURE DECISION REQUIRED.** Production tracing now definitively proves that VPS ASR is invoked after the transcript 404, but the ASR request fails at the upstream 524 boundary before a transcript/cache result is returned. Batch 12 cannot close as complete without an infrastructure decision about the synchronous VPS ASR path or an explicitly approved asynchronous design.

## Batch 12E — VPS ASR gate hypothesis verification (2026-08-27)

### Dependency inspection

- `fetchViaVpsAsr()` uses `YTDLP_API_URL`, optionally attaches `YTDLP_API_KEY`, and forwards the trace ID to `/api/asr`. It does not call Groq and does not consume Worker `GROQ_API_KEY`.
- `fetchViaWhisper()` is the separate Worker-direct Groq path and still requires Worker `GROQ_API_KEY`.
- Cloudflare secret names included `YTDLP_API_URL`, `YTDLP_API_KEY`, and `GROQ_API_KEY`; values were not read.
- The active Worker deployment was `82f56538-b474-41b7-b560-c9ab168d65d4`.

### Gate decision

- The suspected gate defect was rejected. The Worker had the relevant secret bindings, and the production trace proved that the VPS ASR branch was entered after VPS transcript returned 404.
- No Worker gate change was made. Worker-direct Whisper remains protected by its own `GROQ_API_KEY` requirement, while VPS ASR remains dependent on the VPS URL and optional forwarded API key only.

### Same-fixture trace

- The same `uPRSigrDt0Q` fixture was requested once directly through the deployed Worker while a narrowly filtered Worker tail was active.
- Trace: `f4cc9f91-14ed-4730-b5d2-8e7448d96f50`.
- Worker sequence: `request_start` → `vps_transcript_start` → transcript HTTP 404 → `vps_asr_start` → `vps_asr_result` HTTP 524 / unusable → provider cascade → final HTTP 404.
- VPS transcript tracing recorded HTTP 404 after `24935ms`. No corresponding VPS ASR `request_finish` event appeared for the exact trace. The Worker received the upstream 524 at approximately 125 seconds.
- The direct Worker response was HTTP 404 with no transcript. No successful ASR result or cache transition occurred, and no duplicate ASR/Groq call was confirmed.

### Batch 12E final classification

**BATCH 12 INFRASTRUCTURE DECISION REQUIRED.** The gate is not the defect: VPS ASR is definitely invoked, but the synchronous upstream request ends in HTTP 524 before producing a result. Resolving this requires an infrastructure/upstream-duration decision or an explicitly approved asynchronous design; no speculative code change was made.

## Batch 12F — direct VPS ASR timing proof (2026-08-27)

### Direct probe

- VPS preflight remained healthy: `echolearn-ytdlp.service` active, port 80 listening, `/api/health` returned `status: ok`, `asr:true`, and `asrMaxDuration:1800`.
- The existing production `YTDLP_API_KEY` was used internally from the service configuration for the localhost request. Its value was not displayed, logged, or stored.
- Fixture: `https://www.youtube.com/watch?v=uPRSigrDt0Q`.
- Endpoint: `http://127.0.0.1:80/api/asr` on the confirmed AWS VPS.
- Trace ID: `b12e-direct-20260827-1423`.
- The first attempted request was rejected with HTTP 401 because `/proc` access was denied while obtaining the key; it did not enter ASR and was not treated as probe evidence. A single valid authenticated probe then ran to completion.

### Result and timing

- Valid direct localhost request: HTTP 502, approximately 216 seconds wall-clock, response contained 0 transcript lines.
- VPS tracing: `/api/asr`, HTTP 502, `elapsedMs:216313`, `outcome:"failure"`.
- The current VPS source defines `GROQ_TIMEOUT=180` seconds and returns HTTP 502 for a final Groq request failure. The measured duration is consistent with audio preparation plus the configured Groq timeout, but the deployed tracing middleware does not emit internal metadata/audio/ffmpeg/Groq stage events.
- Therefore the exact internal sub-stage cannot be proven from available logs; Groq success, transcript parsing, and cache write did not occur. No cache repeat was performed because the first request failed.

### Cloudflare/browser comparison

- Previous Worker trace: VPS ASR returned HTTP 524 at approximately 125 seconds.
- Direct VPS ASR: failed after approximately 216 seconds, exceeding both the approximately 125-second Cloudflare boundary and the approximately 120-second browser/Worker budget.
- This proves the Cloudflare 524 is secondary to a slow/failing synchronous VPS ASR operation, not evidence of a Worker gate defect. It does not prove a healthy ASR duration because the direct request itself failed.

### Batch 12F final classification

**BATCH 12 INFRASTRUCTURE DECISION REQUIRED.** Direct access bypassed Cloudflare and still produced HTTP 502 after approximately 216 seconds with no transcript. The next resolution requires provider/VPS investigation or an explicitly approved asynchronous/request-lifetime design; no bounded source fix was justified and no async architecture was implemented.

## Batch 12G — VPS ASR stage diagnosis (2026-08-27)

### Safe tracing deployment

- Added stage-level VPS tracing for ASR start/finish, cache hit/miss, metadata, audio extraction, audio-file readiness, Groq attempts/errors/success, and cache writes.
- Tracing fields are allow-listed and contain no API keys, cookies, authorization headers, URLs, or response bodies. Groq HTTP failures now preserve only the status/category in both traces and client-safe error details.
- Added deterministic mock tests for successful parsing, transient HTTP errors, timeout retries, and empty/malformed speech responses. No live provider is used by the tests.
- Created rollback backup `/opt/echolearn-ytdlp/main.py.bak-20260827-033448`, deployed the traced source, restarted `echolearn-ytdlp.service`, and verified `/api/health` remained healthy with `asr:true` and `asrMaxDuration:1800`.

### Direct provider isolation

- Synthetic 3-second MP3 through the deployed `_groq_transcribe()` path: Groq response received in `143ms`; `groq_success` emitted with one provider segment. This proves the VPS-to-Groq request, authentication, and response parser are functional for a valid audio file.
- Same fixture `uPRSigrDt0Q` short-audio diagnostic: audio extraction produced no MP3. Direct yt-dlp attempts failed in roughly 1.5–1.8 seconds each; proxy attempts also produced no output. Groq was not entered for this path.
- Bounded yt-dlp metadata comparison with and without the configured site cookie produced the same error and exit code: `Sign in to confirm you're not a bot`. The configured cookie file did not change the result and is not a YouTube-authenticated session.
- Full localhost `/api/asr` reproduction for the same fixture: client timeout after `330.001s`, HTTP `000`, zero bytes received. The traced service still had a yt-dlp child running after the client timeout; that exact diagnostic child was terminated and the VPS health endpoint recovered. No Groq or cache-write success was observed.

### Finding and classification

- Root cause is the YouTube upstream bot-check blocking yt-dlp on the VPS data-center path; the existing non-YouTube cookie does not bypass it. The resulting synchronous extraction wait outlives the client/Cloudflare budgets, explaining the apparent 524/502 and the lack of transcript/cache result.
- No bounded EchoLearn application fix is justified by this evidence. Groq, parsing, and tracing work when supplied a valid audio file. DNS, Cloudflare timeout, credentials, and provider configuration were not changed. Async architecture remains unimplemented because successful real-video ASR duration was not proven.

### Batch 12G final classification

**BATCH 12 INFRASTRUCTURE DECISION REQUIRED.** The VPS ASR path is now observable and the exact failure is upstream YouTube bot protection during audio/metadata extraction, followed by a synchronous request that can remain alive after the caller times out. Resolving this requires an approved YouTube acquisition/authentication or asynchronous infrastructure decision; no speculative product change was made.

## Batch 12H — bounded YouTube fallback and process-lifecycle repair (2026-08-27)

### Production acquisition configuration

- VPS service environment contains `YTDLP_PROXY`, `YTDLP_COOKIES`, `YTDLP_API_KEY`, and `GROQ_API_KEY`; values were not displayed.
- The configured cookie file exists and is readable by the ubuntu service user. It is a non-YouTube/site cookie and is no longer passed to YouTube commands.
- The existing proxy endpoint is functional: a minimal egress request returned HTTP 200 in approximately 4.8 seconds, with an egress classification different from the AWS host IP. Proxy credentials and endpoint value were not exposed.

### Same-fixture matrix

- Direct metadata/audio path: YouTube bot-check (`Sign in to confirm you're not a bot`).
- Explicit residential-proxy metadata path: success, yt-dlp exit 0, approximately 44 seconds.
- Explicit residential-proxy audio path with the existing cookie: HTTP 403 while downloading video data, no MP3.
- Explicit residential-proxy audio path without the existing cookie: `Please sign in`, no MP3.
- Therefore the proxy can reach YouTube metadata but cannot acquire this video's media without YouTube-authenticated access. This is not a missing proxy environment variable or a Groq failure.

### Bounded implementation

- Added narrow yt-dlp failure classification and immediate direct-to-proxy fallback on bot-check/media-forbidden errors; deterministic bot-check errors no longer consume all direct retries.
- Added process-group execution for yt-dlp and termination/reaping of the process group on timeout, including ffmpeg children.
- Added a 100-second ASR wall-clock deadline and passed remaining time to metadata/audio subprocesses, preventing client timeout followed by multi-minute server retries.
- Restricted the existing site cookie to non-YouTube targets.
- Added deterministic tests covering bot-check fallback, proxy success handoff to Groq, bounded proxy failure, process timeout/reaping, expired deadline, cookie isolation, and all previous Groq tracing cases.

### Deployment and validation

- Created rollback backup `/opt/echolearn-ytdlp/main.py.bak-20260827-1725`, deployed the first bounded fallback/process fix, then created `/opt/echolearn-ytdlp/main.py.bak-20260827-1745` and deployed the final deadline/process version.
- VPS syntax and regression suite: **10/10 passed**.
- Post-deployment localhost ASR reproduction for `uPRSigrDt0Q`: HTTP 504 after approximately `99.1s`; no exact-fixture yt-dlp process remained afterward and `/api/health` returned `status:ok, asr:true`.
- No successful real audio, Groq ASR, transcript cache write, cache repeat, Worker result, or browser transcript was possible because YouTube media authentication remained unavailable.
- Frontend baseline remains the previously validated 341/341 tests, TypeScript pass, lint 0 errors/13 existing warnings, and build pass; these were not rerun because this task changed only the VPS service and was externally blocked before frontend lifecycle validation.

### Batch 12H final classification

**YOUTUBE ACQUISITION DECISION REQUIRED.** The bounded application defects are repaired and deployed, but the existing residential proxy only reaches metadata; this fixture's media requires YouTube-authenticated acquisition. Continuing requires an approved YouTube account/cookie architecture or another authorized acquisition provider. No credentials were requested, exported, rotated, or exposed.

## Batch 12I — PO Token provider diagnostic (2026-08-27)

### Runtime and provider compatibility

- VPS runtime baseline: yt-dlp `2026.07.04`, Python `3.14.4`, Node `v22.22.1`, ffmpeg `8.0.1`, git `2.53.0`; approximately 15 GB disk and 502 MiB available memory were observed.
- Production yt-dlp initially reported no PO Token provider. A temporary isolated venv installed `bgutil-ytdlp-pot-provider==1.3.2` alongside the existing yt-dlp version; no production venv changes were made.
- The provider plugin was discovered successfully. The official script provider was compiled temporarily with the existing Node/corepack toolchain; no permanent service, Docker container, public listener, or port 4416 listener was created.

### Same-fixture POT matrix

- Direct `mweb + script-provider + no cookies` sanity test: provider was discovered, but the provider script timed out while generating the GVS token; yt-dlp reported that no usable GVS token was available and the video remained `LOGIN_REQUIRED`.
- Existing-proxy `mweb + script-provider + no cookies` audio test: timed out at the 120-second bound, produced 0 audio bytes, and the provider script again timed out. No real ASR was entered.
- Generated PO Token values, visitor data, signed URLs, cookies, and proxy credentials were not written to source, report, shell history, or persistent configuration. Temporary provider clone, venv, logs, and audio directories were removed; no provider process or port 4416 listener remained.

### Decision

- PO Token provider discovery was proven, but PO Token media acquisition for `uPRSigrDt0Q` was not proven. The result does not justify integrating POT args into production or creating a persistent provider service.
- The remaining blocker is YouTube account/media authentication or provider behavior for this fixture. No account cookies were requested/exported, no credentials were changed, and no paid provider was added.

### Batch 12I final classification

**YOUTUBE ACQUISITION DECISION REQUIRED.** Temporary PO Token diagnostics did not restore media acquisition: direct script mode timed out generating the GVS token, and proxy script mode timed out without audio. The existing bounded VPS fixes remain deployed but uncommitted locally; a future persistent provider or YouTube-authenticated acquisition requires an explicit infrastructure/security decision.

## Batch 12J — bounded acquisition error and user-facing closure (2026-08-27)

### Root cause and implementation

- The confirmed limitation is YouTube media acquisition: yt-dlp can classify the fixture's bot-check/media-forbidden responses, but no audio reaches Groq. This is upstream acquisition failure, not transcript parsing, Groq, persistence, or React state failure.
- VPS `/api/asr` now returns a safe machine-readable `youtube_acquisition_blocked` error with HTTP 424 after the bounded direct/proxy attempts. Raw yt-dlp/provider details remain server-side and are not sent to users.
- The Cloudflare Worker recognizes that code and stops the fallback cascade. The frontend preserves normal caption behavior while showing the localized bounded message and omitting a misleading retry action for this known limitation.

### Automated validation

- VPS `main.py` Python syntax compilation: passed.
- VPS deterministic suite could not import locally because the bundled Python does not include FastAPI; no local VPS unittest pass is claimed. The route-level test is included for execution in the deployed VPS environment.
- Frontend full Vitest suite: **342/342 passed**.
- Frontend targeted YouTube service suite: **9/9 passed**, including typed blocked-response propagation without a Vercel retry.
- TypeScript build check and production build: passed.
- Targeted ESLint: **0 errors**, 7 existing `StudyPage` hooks warnings.
- Worker `node --check`: passed.
- `git diff --check`: passed, with only existing line-ending and Git ignore-permission warnings.

### Repository state

- Local commit: `ca60ab2` (`fix: surface bounded YouTube transcription failures`).
- Push was explicitly attempted and rejected by the environment safety reviewer because the visible conversation contains an earlier no-push constraint; no workaround was used. CI, Worker/frontend production deployment, final VPS source synchronization, and production browser smoke are therefore pending explicit push authorization.

## Batch 12K — final production synchronization evidence (2026-08-27)

### Repository and deployment

- The previously blocked push was later explicitly authorized. `ca60ab2`, `4adceff`, `2a84a11`, `f0fbcf2`, `bc9596f`, and `9be0e88` are pushed to `origin/main`; each relevant CI run was green where checked, and the final docs-only CI is pending after this append.
- Verified PEM fingerprint: `SHA256:xC/UuN1xVq5OJ6+C5lBhbNkdiHfVnVOZshQG6dmHrno`. SSH identity `ubuntu@3.107.69.57` and host identity matched the known EchoLearn VPS.
- Final committed VPS source hash and deployed `/opt/echolearn-ytdlp/main.py` hash match: `f037a612207e48e85bf785dffb9a9cfd4424333573deaa069a0729724aa44714`.
- Final rollback backup: `/opt/echolearn-ytdlp/main.py.bak-20260827-230828`.
- `echolearn-ytdlp.service` is active/running, port 80 is listening, `/api/health` returns `status:ok`, `asr:true`, and `asrMaxDuration:1800`. No yt-dlp or ffmpeg process remained after smoke tests.
- Production Worker final revision: `7baae305-f911-4b56-956d-c2fa784a69ec`. No Worker secrets, routes, DNS, or credentials were changed.

### Production smoke evidence

- Known blocked fixture `uPRSigrDt0Q`: Worker returned HTTP 424 in `79.116799s`, trace ID `e53bc8df-98ea-45ff-af10-f7d90be0c1cb`, with only `youtube_acquisition_blocked` and the safe user-facing message. No raw yt-dlp/provider detail was exposed.
- Existing canonical normal fixture `dQw4w9WgXcQ`: Worker returned HTTP 200 in `7.648002s`; English caption lines were returned and rendered by the normal transcript contract.
- Existing fixture `iG9CE55wbtY` returned the bounded 424 path during this run and is not recorded as a normal-caption pass. This is an upstream availability result, not evidence that all normal caption sources are broken.
- Production homepage `https://echo-learn.uk/`: HTTP 200. Worker `/api/health`: HTTP 200.
- Direct isolated-browser visual verification was not repeated in this round because the available production API result was sufficient to validate the new contract and no isolated browser session was attached; frontend automated tests cover typed failure propagation and localized UI branching.

### Final classification

**BATCH 12 CLOSED — BOUNDED YOUTUBE ACQUISITION LIMITATION.** Production blocked-media failures now terminate with a bounded, machine-readable response and coherent user-facing behavior; normal caption retrieval remains verified with the canonical `dQw4w9WgXcQ` fixture. This does not claim successful ASR for YouTube videos whose media acquisition is blocked.

### Final CI correction

- The docs-only CI triggered by `f3b9614` completed successfully: test and e2e jobs both passed. The earlier “pending” wording in Batch 12J was an intermediate snapshot and is superseded by this final evidence.

## Batch 13 — mobile/PWA focused validation (2026-08-27)

### Batch 12 visual closure

- In a fresh Codex isolated QA browser tab, the blocked production fixture `uPRSigrDt0Q` completed without refresh after approximately two minutes. The loading state cleared and the page displayed the localized bounded message `This video can't currently be transcribed automatically` / `Try another video with captions.` with no misleading Retry action or infinite spinner.
- The normal production fixture `dQw4w9WgXcQ` loaded official YouTube subtitles in approximately 10 seconds. The UI displayed 61 subtitle lines, cleared loading, and retained usable audio/study controls.

### Mobile/PWA findings and fix

- Physical Android detection was attempted with the configured local `adb.exe`; `adb devices -l` returned no connected devices. Physical Android and installed-PWA validation are therefore not executed.
- Isolated mobile viewport validation at 393x873 found a P2 Vocabulary layout defect: the filter/sort toolbar kept a single-row `justify-between` layout and produced `scrollWidth=424` for a 378px content viewport. Study, Sentences, and Settings did not reproduce the overflow.
- Fixed the Vocabulary toolbar to stack on narrow screens and restore the existing row layout at the `sm` breakpoint. Added a focused Playwright regression test covering the narrow Vocabulary toolbar and its controls.
- Local mobile validation after the fix reported zero horizontal overflow. Study remained usable in portrait and landscape; the local deterministic sample contained 554 transcript lines and remained navigable. The browser console reported no errors or warnings during the checked flow.

### Automated validation

- Playwright mobile Chromium + WebKit: **10/10 passed**, including the new Vocabulary regression, orientation/visibility, offline/reconnect, and PWA manifest tests.
- Targeted ESLint: **0 errors**, one existing `VocabularyPage` hooks dependency warning.
- `npx tsc -b`: passed.
- `npm run build`: passed; PWA service worker generated successfully.
- `git diff --check`: passed, with existing Windows line-ending and Git ignore-permission warnings.
- Long-transcript 1,000–3,000-line stress, 200–500-item Vocabulary stress, physical touch/keyboard, installed-PWA lifecycle, and controlled old→new service-worker transition were not executed. Existing deterministic mobile tests cover the lower-cost approximations; no physical-device PASS is claimed.

### Batch 13 classification

**SYSTEM TESTING PHASE COMPLETE — WITH PHYSICAL/PWA LIMITATIONS.** Batch 12 visual smoke passed, the only newly observed mobile defect was a bounded P2 layout issue and is fixed with regression coverage, and CI/automated mobile validation remains green. Future validation should use feature-specific tests, normal CI regression, risk-triggered production smoke, and a release checklist rather than automatically opening another large testing batch.

## 2026-09-01 ECHO-20260901-0139 subtitle stabilization closure

- A real in-process application cascade using the modified Worker, modified Vercel handler, current frontend service, real YouTube responses, empty ASR configuration, and no cache produced HTTP 200 with non-empty captions for all 7 confirmed-caption controls. `9bZkp7q19f0` returned `language=ko` under the existing preferred-language/first-available semantics; this is caption acquisition success with a separately reportable language mismatch.
- The `ysz5S6PUM-U` no-caption negative control returned a typed HTTP 504 `provider_timeout` with zero lines after the Worker caption deadline; no fabricated transcript and no ASR/Groq call were used. Direct Vercel probes for dQw, kJQ, and hTW were HTTP 200 in approximately 0.6–1.1s, so the 6.5s fallback budget was not increased.
- Local validation: focused transcript/Worker/Vercel/health tests **53/53**, full Vitest **390/390**, VPS Python tests **40/40**, `py_compile`, TypeScript, build, Worker syntax, Wrangler dry-run, lint (**0 errors, 13 existing warnings**), and `git diff --check` passed. The temporary real-provider harnesses were removed.
- Production preflight: app, Worker health, and VPS health were HTTP 200; VPS service was active, port 80 was listening, current deployed VPS source hash was read, and rollback backups were present. The Worker candidate was deployed as version `9fcbd50b-d197-4691-951b-d9a8c4039197`; the prior production Worker version `7586f981-78a1-4537-8d9d-2660a0f3c7d5` remains the rollback point. Vercel was not deployed.
- One sequential production Worker matrix, with no retries and no `allowAsr`, returned 7/7 positive caption successes: iG9 427 lines, dQw 61, 9bZ 67 ko, kJQ 90, hTW 53, L_j 73, and M7 466. The negative ysz result was truthful. CLI Playwright then verified production guest → Study → YouTube import for iG9: `/study`, 277 visible transcript lines, usable main/Audio Mode controls, and zero page errors.
- Minimal Worker source-record commit `6176800e59ce4bdd8bb67b60ac78e92fada9e954` was pushed to `origin/main`; GitHub Actions CI run `33465596903` passed both test and E2E jobs, and the push-triggered Vercel deployment reached `READY`. The current frontend/Vercel and VPS candidates remain local and undeployed. Only the authorized Worker candidate was deployed. No secrets, subtitle bodies, ASR, Groq, or new provider were used.

### Production-state and cache reconciliation

- Persisted runtime history confirms the `02:14Z` Wrangler deploy command used the local Worker candidate and returned version `9fcbd50b-d197-4691-951b-d9a8c4039197`; live deployment status now shows that version at 100% in deployment `974ee470-4498-4c79-b74a-b6109cc2feaf`. The earlier `7586f981-78a1-4537-8d9d-2660a0f3c7d5` reference is the immediately prior Worker version, not the current active version.
- The source-record push produced verified `READY` Vercel deployment `dpl_GAAtbhbfZmjgevm1Pfz1vGeU5n5X` for commit `6176800e59ce4bdd8bb67b60ac78e92fada9e954`; subsequent docs-only commits may trigger equivalent-source Vercel rebuilds, so their exact deployment IDs are operational metadata rather than long-term source of truth. The transcript lambda digest remained unchanged, and local `api/transcript.ts` and frontend service changes were excluded. Current app and Worker health endpoints were HTTP 200.
- Read-only pre-release baseline probes are recorded only, not repeated: public Worker dQw returned `200/61/en` in about 1.15s and iG9 returned `200/427/en` in about 0.24s; current production Vercel dQw returned `200/61/en` in about 6.24s, while kJQ and hTW each returned `504` after about 6.5s. These are baseline observations, not additional matrix rows.
- Current VPS `/opt/echolearn-ytdlp/main.py` is active with mode/owner `664 ubuntu:ubuntu`, port 80 listening, and source hash `4b815ee359e75f4a2f7a4a8566614f1cc3e5a21ecf3dd824d5da8488a9e26790`; local candidate hash is `5ddf90a2ae573ef1a39bcfa372ccba22dc9bc979cee60bd80b78a6fc54bb4bb5`. Rollback backups were present. The VPS candidate was not deployed and is not required by the accepted Worker default caption route.
- Both the active Worker and local Worker candidate use `TRANSCRIPT_CACHE_VERSION='1'` and the same `videoId`/`lang`/`v=1` cache key namespace. The completed matrix did not capture a cache header per row, so it is production reliability evidence but not a cold-provider matrix. The later read-only dQ/iG9 baseline probes may have warmed those shared-namespace entries; no cache purge or repeat matrix was performed.
- Release-set decision: only the Worker source was needed for the already accepted Worker-only production path. Vercel/frontend and VPS changes remain local future-candidate work; no additional production component was deployed solely because those diffs exist.

## Batch 13 release closure (2026-08-28)

- Commit `0b25e79` was pushed to `origin/main`; GitHub Actions CI run `33070679358` completed with both `test` and `e2e` jobs successful.
- Vercel production deployment `dpl_qqzAe4cfgchzpVrEsWRwSZnUadoF` is `READY` for commit `0b25e79895fdf552445823d654dd8f95ae1b7b8e`; `https://echo-learn.uk/` returned HTTP 200.
- Production isolated mobile smoke at 393px confirmed Vocabulary `clientWidth=393`, `scrollWidth=393`, overflow `0`, stable filter/sort interaction, and successful Vocabulary → Study → Vocabulary navigation.
- Production Study smoke with `dQw4w9WgXcQ` confirmed visible captions, cleared loading, usable Play/Reload controls, no acquisition-blocked message, and zero horizontal overflow. No additional Batch 12 fixture was run.
- Final repository state before this factual docs-only closure is clean and synchronized; this note is the only follow-up change and does not require another production smoke.

**SYSTEM TESTING PHASE COMPLETE.** Future work should use feature-specific tests, normal CI regression, targeted production smoke when risk warrants, and a release checklist. The documented physical-device, installed-PWA, hardware-input, SW-transition, and extreme-stress limitations remain future risk-triggered checks rather than reasons to open another comprehensive testing batch.

## 2026-09-04 ECHO-20260904-0021 — AWS browser-host feasibility inventory

### Scope and actual result

- Performed a read-only inventory of the existing AWS host `3.107.69.57`; no Chrome/Chromium, Xvfb/`xvfb-run`/`xdpyinfo`, `DISPLAY`, browser automation runtime, Docker/Podman/containerd/nerdctl, or task-local CDP runtime was available.
- Host capacity observed: 2 CPUs, 908 MiB total RAM, approximately 510 MiB available, and 0B swap. No browser experiment ran because the required browser/display precondition was absent.

### Evidence boundary and state

- Sanitized external evidence is retained at `D:\CODE\API\echolearn\evidence\ECHO-20260904-0021` (`inventory.json`, `manifest.json`, checksums). It records the inventory and the explicit no-browser-experiment boundary; it contains no claim about server timedtext semantics.
- Local repository remained on `main`, with the existing dirty work preserved; GitHub state was not changed. The AWS production service and system packages were not mutated, and no install/download/SSH action was performed in this cycle.

### Remaining gap and next decision

- The server-side browser feasibility question remains open: browser working-set, Xvfb overhead, request concurrency, and server cost were not measured. Given 908 MiB/no swap, do not co-locate a persistent browser stack by assumption.
- Next decision: evaluate a separately isolated browser execution host/service first. A one-shot user-space pilot on the existing host is only a later, explicitly authorized gate with a measured budget and immediate stop conditions.

## 2026-09-04 ECHO-20260904-0032 — local browser-native YouTube subtitle prototype

### Method and actual result

- Local-only prototype used directly spawned headed system Chrome `152.0.7977.66` with a fresh disposable `--user-data-dir`, loopback CDP, `--no-first-run`, and `--no-default-browser-check`; Playwright attached with `chromium.connectOverCDP`. The headed Playwright launch path was not equivalent on this machine and produced empty timedtext bodies, while external Chrome restored the usable result.
- M7 baseline and controlled media A/B both classified **SUCCESS**: one `200 application/json` timedtext response, 65,976 bytes, 466 parsed events/segments, and matching timeline results. Media was blocked after the A/B comparison for the bounded matrix; no audio extraction, ASR, or media result was used.
- The diversified matrix ran exactly once for 24 non-target videos: **18 SUCCESS**, **4 PLAYER_BLOCKED**, **1 CAPTION_PARTIAL_COVERAGE**, and **1 NO_CAPTION_TRACK**. Intended-available content was 18 controls with **17/18 SUCCESS**; six controls were excluded from that denominator. Four fixtures ran three stability repeats plus baseline: **12/12 SUCCESS**, with unchanged classification and line-count ranges.

### Validation, resource observations, and evidence boundary

- Parser validation: **8/8**; full application tests: **441/441**; typecheck and build passed; lint had **0 errors / 13 existing warnings**; `git diff --check` passed. The cleanup race fix was exercised, including task-owned Chrome/profile cleanup behavior.
- Observed matrix latency was **11,554–14,225 ms**, average **12,047 ms**. Node RSS was recorded at **140,845,056–262,078,464 bytes**. Chrome working-set and server-side resource/cost measurements were unavailable; bandwidth and monetary cost were not measured.
- Sanitized external evidence is retained at `D:\CODE\API\echolearn\evidence\ECHO-20260904-0032`; the local runbook also exists in gitignored `.workbuddy/memory/MEMORY.md`. This tracked entry is the durable recovery record for the launch method and acceptance boundary.
- This is local browser evidence only: it does not prove Worker/Vercel/VPS/AWS/production behavior. No caption text, cookies, login/session data, request secrets, media/audio, or ASR output was persisted or reported.

### Remaining gap and next decision

- The prototype supports a bounded feasibility stage, but does not justify production integration. Chrome working-set, Xvfb/display overhead, host concurrency, sustained failure rate, bandwidth, and cost remain unmeasured.
- Next decision: run a separate fresh-profile browser execution pilot at single concurrency with explicit privacy, timeout, cleanup, RSS/Chrome working-set, bandwidth, and fail-closed classification evidence. Do not install on or co-locate with the 908 MiB/no-swap AWS VPS without a separately authorized one-shot budget test; stop on memory pressure, swap/OOM, cleanup failure, ambiguous player/caption state, secret/cookie exposure, or any production mutation risk.

## 2026-09-04 ECHO-20260904-0148 — local browser-resource telemetry hardening

### Implementation and safety boundary

- Extended only `scripts/local-native-youtube/` with a sanitized telemetry helper and focused tests. Windows resource sampling uses the spawned Chrome root PID and a CIM/PowerShell descendant walk, so Chrome children are included even when they do not carry the disposable profile argument. The sampler records peak aggregate working set, private bytes, process count, and a coarse aggregate CPU-time delta; sampling failures remain nullable diagnostics and do not alter caption classification.
- Added CDP `Network.requestWillBeSent`, `Network.loadingFinished`, and `Network.loadingFailed` accounting. Only request count, encoded bytes, failure/event counters, and coarse `caption`/`media`/`other` categories are retained. Media and `/videoplayback` requests remain blocked for the positive control. No raw URL, query string, header, cookie, token, request body, or caption text is persisted.
- Added `--about-blank-smoke` (three sequential fresh-profile cycles) and `--positive-control` (one M7-only fresh-profile capture) modes. The first smoke attempt exposed a sampler timeout/PowerShell compatibility defect and was not used as resource evidence; after the in-scope fix, the required smoke was rerun successfully. No bulk matrix, target `YweN5PUyGgc`, A/B, ASR, audio, server install, production mutation, commit, or push was performed.

### Actual validation and measured result

- Focused local harness tests: **13/13 PASS** across the parser and telemetry test files. `node --check` passed for the changed harness modules. `git diff --check` passed.
- About:blank smoke: **3/3 PASS**, all with 0 initial cookies, 0 CDP requests, 0 encoded bytes, 2 valid process-tree samples, 0 sampling failures, and first-attempt profile cleanup. Latency was **6,032–6,127 ms**. Peak aggregate Chrome tree working set was **926,441,472–938,397,696 bytes**; private bytes **562,106,368–580,759,552 bytes**; peak process count **12**; peak aggregate CPU-time delta **2,078–2,312 ms**.
- Exactly one M7 positive control with media blocked: **SUCCESS**; latency **13,605 ms**; Node RSS **111,534,080 bytes**; peak aggregate Chrome tree working set **1,956,499,456 bytes**; peak private bytes **1,482,866,688 bytes**; peak process count **15**; six valid samples, 0 sampling failures, and peak aggregate CPU-time delta **17,484 ms**. Network telemetry observed **210 requests** and **5,158,461 encoded bytes**: caption **1 / 12,899 bytes**, media **15 / 0 bytes**, other **194 / 5,145,562 bytes**; 189 loading-finished and 17 loading-failed events; no malformed telemetry events. Cleanup removed the fresh profile on the first attempt.
- Caption evidence remained independent of telemetry: player `OK`, two caption tracks, one 200 `application/json` timedtext response, 65,976 in-memory response-body bytes, 466 parsed events/segments/usable lines, timeline span ratio approximately 0.990, and 0 page errors. Telemetry was diagnostic only and could not create a caption success.

### Capacity recommendation and evidence boundary

- The measured active single-browser peak is approximately **1.96 GB aggregate working set / 1.48 GB private bytes**, with a quiet about:blank baseline of approximately **0.93 GB working set / 0.56 GB private bytes**. For a future single-concurrency server pilot, use an isolated host with at least **4 GiB total RAM** and an explicit no-swap/OOM policy; treat **2.5 GiB available-memory headroom for the task-owned browser tree** as a minimum acceptance budget derived from the observed 1.96 GB peak plus modest operating margin. This is sizing guidance, not provisioning or a cost estimate.
- Pilot acceptance should require fresh logged-out profiles, media blocking, bounded timeout, valid process-tree samples, encoded-byte/category telemetry, no memory pressure/swap/OOM, first-attempt cleanup, and fail-closed handling when resource observation is unavailable. Start at one concurrent browser only; do not infer higher concurrency, sustained rates, provider pricing, or monetary cost from this single local control.
- This is **local Windows evidence only**. It does not establish AWS/VPS feasibility, server performance, Worker/Vercel behavior, production acceptance, or any deployment recommendation. The existing 908 MiB/no-swap AWS host remains unsuitable for this browser pilot by measured capacity margin, and no infrastructure action is authorized in this task.

### Repository state at cycle end

- Branch remained `main`; existing unrelated dirty files and the previously updated `PROGRESS.md` / `TEST_REPORT.md` were preserved. Task-owned additions are limited to the local-native-youtube telemetry helper/test and harness changes. No commit, push, deploy, AWS mutation, paid infrastructure, or system package installation occurred.

## 2026-09-04 ECHO-20260904-1116 — Linux headed/Xvfb pilot preflight blocker

### Scope and actual result

- Re-anchored the accepted local telemetry checkpoint and performed a read-only local provisioning preflight. No browser traffic, host mutation, package installation, cloud API mutation, production AWS access, commit, push, or deploy was performed.
- No reusable separate non-production host was identified. The existing AWS host remains explicitly excluded because it has 908 MiB RAM and no swap.
- No configured provisioning path was available on this machine: `aws`, `doctl`, `gcloud`, `az`, Terraform, Docker, and Podman were absent; expected AWS/DigitalOcean/GCP/Azure configuration directories were absent. `ssh`/`scp` binaries exist, but no usable non-production host identity or connection target was available; the local SSH directory could not be inspected due to access denial, and no key contents were read.

### Evidence boundary and state

- The Linux headed/Xvfb browser pilot was **not executed** because the required separate host and credentialed access path were absent. Therefore there are no pilot memory, process, network, caption, latency, or cleanup measurements to report for this task.
- Local repository remained on `main` at `HEAD=6616139a0810f45b09c5c232054fa6860c9c4aa3`, matching `origin/main`; unrelated dirty work was preserved. Production Worker/Vercel/VPS/AWS state was not changed.

### Blocker and next decision

- Genuine blocker requiring user-supplied external state: provide an already-running isolated Linux host with SSH access, or explicitly configure one approved disposable-host provisioning path with region/plan/cost and credentials available to this environment.
- Once supplied, the next bounded gate remains one isolated headed/Xvfb pilot at single concurrency with at least 4 GiB RAM, a 2.5 GiB task-browser available-memory budget, fresh logged-out profile, media blocking, two accepted positive controls, sanitized telemetry, deterministic cleanup, and no production integration. No host was created, so there is no host to destroy or hand back.

## 2026-09-04 ECHO-20260904-1128 — browser-native fallback productization gate

### Decision

- **GO for gated productization work; NO-GO for production integration in this cycle.** The accepted local evidence shows meaningful value for caption-bearing videos whose normal server/provider paths are blocked or fail transiently: 17/18 intended-available matrix controls succeeded, four-fixture stability was 12/12, and one media-blocked M7 control succeeded with structured captions.
- The prior DigitalOcean VM lifecycle is complete: `170.64.143.102` was intentionally destroyed after `USER_MAY_DESTROY_DO_VM=true`; materially distinct yt-dlp/session/cookie/visitor-data axes were exhausted. It is not unfinished work and must not be recreated for this decision.

### Current production flow and boundary

- The browser client first uses an explicitly configured local proxy only when the user opts in. The normal production service calls the Cloudflare Worker `/api/transcript`; caption-only Worker requests read the Worker cache first, then run the bounded InnerTube, webpage, Invidious, and Piped caption cascade under an approximately **11 s** caption deadline. Worker/VPS credentials remain server-side.
- The frontend treats a Worker caption timeout as transient and gives same-origin Vercel `/api/transcript` one independent bounded attempt. Vercel may call the VPS caption route with its server-side key and otherwise uses the bounded `youtube-transcript` fallback. The VPS caches successful caption payloads in memory and runs yt-dlp caption-only acquisition; ASR/audio remain explicit separate paths.
- If those paths do not return usable lines, the frontend may continue through its existing proxied InnerTube/web/npm strategies or surface typed/diagnostic failure. `captions_not_found`, `transcript_disabled`, `asr_required`, invalid/auth/rate-limit outcomes, and known semantic outcomes are not equivalent to provider transport failure. The local dirty Worker/VPS files are future candidates, not the accepted production release.
- There is currently no browser-native production provider, browser cache, browser host, or Linux/Xvfb evidence. Existing Worker cache namespace is `v=1`; frontend in-flight dedup is keyed by video/language/ASR mode; VPS cache stores successful results only.

### Product value, limits, and option ranking

| Option | Assessment |
|---|---|
| A. Dedicated single-concurrency browser fallback after eligible provider failure | **Recommended.** Targets the demonstrated access/provider gap while preserving the fast caption cascade and limiting resource/abuse exposure. |
| B. Browser-first for every YouTube cold miss | Reject. The observed 13.6 s latency and 1.96 GB Chrome-tree peak make it an unnecessarily expensive first path when current providers succeed faster. |
| C. Managed third-party browser/transcript service | Defer/reject for now. It adds opaque privacy, retention, quota, and pricing dependencies without evidence that it improves this specific failure mode. |
| D. Do not productize browser fallback | Not recommended as the final decision. It would discard a credible 17/18 intended-available recovery signal, though it remains the safe fallback if the Linux gate fails. |

- Plausible coverage: caption-bearing videos where datacenter/provider fetches fail, bot/transport handling differs, or browser-native timedtext access succeeds. The browser path does not create captions where the player exposes no track, does not repair `PLAYER_BLOCKED`, and does not make a partial/truncated caption complete. Those outcomes remain explicit browser diagnostics, not fabricated success.
- Cost/risk characteristics: approximately **13.6 s** local positive latency before any preceding provider-failure time; **1,956,499,456 B** peak aggregate browser working set, **1,482,866,688 B** private bytes, and **15** processes; **5,158,461** encoded bytes across **210** requests with **0** media bytes. A single browser can consume a large fraction of a small host and repeated public requests can create YouTube/provider abuse risk.
- Privacy/security: use only validated video IDs and language, fresh logged-out profiles, loopback CDP, no imported cookies/login, media blocking, no arbitrary URL/SSRF input, and no persisted raw URLs, query strings, headers, cookies, tokens, request bodies, or caption text. Caption lines may pass transiently to the authorized caller because they are the product result; diagnostics must remain sanitized.

### Recommended architecture and exact policy

- Add a dedicated, private browser fallback service behind server-to-server authentication. The existing server orchestration invokes it only after the normal caption providers exhaust an **eligible transport/provider failure**. The service owns one browser slot, Xvfb/headed Chrome lifecycle, profile isolation, resource guard, and cleanup. It is not called directly by the public browser client and is not co-located with the 908 MiB production VPS.
- Eligible triggers: typed `provider_timeout`; typed/gathered `provider_failure`; upstream 5xx/network failure across the normal caption providers; and a future caption-specific acquisition-blocked code if its semantics explicitly mean timedtext access rather than media/audio access.
- Non-triggers: cache hit; `captions_not_found`; `transcript_disabled`; `asr_required`; invalid input; authentication failure; rate limit; user cancellation; known `PLAYER_BLOCKED`; known no-caption-track; and any media/audio acquisition failure. Do not use browser fallback to bypass explicit ASR consent or to turn an ambiguous failure into no-caption truth.
- Proposed bounded budget, to be validated on Linux: **25 s end-to-end** for queue admission, headed acquisition, and cleanup; at most **2 s** waiting for the single slot, approximately **18 s** acquisition, and up to **5 s** forced cleanup. No browser-layer retry. The caller cancels immediately on client disconnect/deadline and the service kills the owned process tree before releasing the slot.
- Single-flight/dedup: coalesce identical `videoId + lang + caption-mode` requests to one in-flight job; never allow concurrent browser jobs in the initial pilot. A stale/late result must be discarded by request generation/trace identity and must not overwrite a newer video/session result.
- Cache: check the canonical caption cache before starting a browser. Write only validated non-empty structured success after cleanup; never cache provider/browser failures or partial results. Use a browser-provider/versioned cache marker rather than silently changing the existing `v=1` namespace during implementation.
- Resource guard: reject admission when the slot is occupied or host memory is below the measured safety floor; sample the full descendant tree; stop on memory pressure, swap/OOM, process-count anomaly, CDP loss, or cleanup ambiguity. A resource-observation failure is a diagnostic/provider failure, never a caption success.
- Safe observability: provider/outcome code, trace ID, latency, queue wait, cache hit/miss, browser version, player status, track count, parsed line/event/segment counts, caption body byte count, total encoded bytes, request count/categories, peak process count, peak working/private bytes, CPU delta, cancellation, and cleanup result. Do not persist raw request identity or content.

### Smallest service contract (design only)

- Internal request: `POST /v1/caption-transcript`, authenticated server-to-server; `{ videoId, lang, traceId, deadlineAt }`. Accept only an 11-character YouTube ID and bounded language value; reject arbitrary URLs and any ASR/media flag.
- Success `200`: `{ ok: true, lines, language, isAutoGenerated, source: "browser-native", diagnostics }`, where diagnostics contain only the safe fields above. `lines` are transient product output and are not written to telemetry logs.
- Failure: internal typed outcomes `browser_timeout`, `browser_runtime_failure`, `browser_resource_guard`, `browser_cancelled`, `browser_busy`, `browser_player_blocked`, `browser_no_caption_track`, `browser_empty_response`, and `browser_partial_coverage`. The orchestrator maps transport/resource failures to existing `provider_timeout`/`provider_failure`; it does not map a browser negative observation into a fabricated success or definitive no-caption result without the existing semantic rule.

### Finite validation ladder and remaining work

1. **Architecture/contract decision — COMPLETE now.** Document option A, trigger taxonomy, budgets, cache/cleanup/privacy rules, and contract. No infrastructure required.
2. **Isolated local implementation/tests — MUST before local real-provider integration; can proceed now.** Add a provider adapter behind the existing orchestration seam, mock the browser service, test eligible vs ineligible triggers, response validation, timeout/cancellation, single-flight, stale responses, cache writes, no-ASR boundary, and fail-closed telemetry. This is local code only and should not alter production routing until the host gate passes.
3. **One batched Linux/Xvfb host lifecycle — MUST before real browser-service integration and MUST before production deploy.** Use one separate 4 GiB+ host; record exact plan/region/cost; install headed Chromium/Chrome plus Xvfb in an isolated user/service boundary; run 2–3 about:blank cycles, then exactly two accepted positives (M7 and one distinct prior positive) with fresh profiles, loopback CDP, no headless flag, media blocked, process-tree peak, encoded network categories, >=25% host memory headroom, timeout/cancellation, orphan scan, and cleanup. Do all host-dependent checks in this one lifecycle; do not recreate the destroyed DO VM or use the production AWS VPS.
4. **Local orchestration integration and high-value E2E — MUST before production deploy.** With the real service endpoint isolated, verify the existing fast path remains first, eligible fallback triggers exactly once, definitive outcomes do not trigger it, two positives return structured captions, negatives remain typed, stale responses cannot overwrite state, and no raw telemetry is persisted.
5. **Production canary/acceptance — MUST before general release.** Requires explicit deployment authorization, feature flag/rollback, server-side auth, one-slot capacity/rate limits, two positive controls plus a bounded negative/blocked control, no media bytes, no orphan processes, no secret/session leakage, and observed failure/timeout metrics. This is not authorized in the current task.
6. **Optional confidence:** larger non-target matrix, controlled concurrency/load, browser-version variance, longer soak, and third-party comparison. None is required before deciding whether the bounded A architecture is worth pursuing.

- Linux/Xvfb reproduction is **not mandatory before isolated local interface/adapter implementation and mocked tests**. It **is mandatory before real browser-service integration acceptance and any production deployment**, because headed/Xvfb semantics, Linux process footprint, cleanup, and anonymous YouTube behavior remain unproven.
- Stage position: architecture decision is complete; local adapter/test work can proceed without infrastructure; the next external gate is exactly one future batched 4 GiB+ host lifecycle followed by two positives. Production integration is not justified yet.

### Repository and environment state

- This cycle changed documentation only. `PROGRESS.md` and `TEST_REPORT.md` were updated; no application/provider code was changed. `git diff --check` passed with existing Windows line-ending/config-ignore warnings.
- Branch remains `main`; `HEAD` and `origin/main` remain `6616139a0810f45b09c5c232054fa6860c9c4aa3`. Existing dirty/untracked work is preserved. No host was created, reused, installed, destroyed, or left running in this cycle; no cost was incurred or estimated.
- GitHub, Worker, Vercel, VPS, AWS, and production state were not mutated. No commit, push, deploy, or production integration occurred.

## 2026-09-04 ECHO-20260904-1137 - isolated browser fallback contract

### Scope and implementation

- Added `src/services/browserTranscriptFallback.ts` as a local-only contract and orchestration seam. It is disabled by default and is not imported by `fetchYouTubeTranscript` or any production route.
- Trigger policy is pure and fail-closed: only `provider_timeout`, `provider_failure`, `network_failure`, and `upstream_5xx` can invoke the fallback. Definitive no-caption, transcript-disabled, ASR-required, invalid/auth/rate-limit, cancellation, known player-blocked, no-track, partial-coverage, media, and audio outcomes remain non-triggers.
- The typed mapper accepts only non-empty structured timed lines with valid timing and maps browser/service outcomes to explicit `provider_timeout`, `provider_failure`, `player_blocked`, `captions_not_found`, `partial_coverage`, `cancelled`, `resource_exhausted`, `slot_unavailable`, `cleanup_failure`, and `invalid_response` errors. Invalid or diagnostic-only responses cannot become success.
- The adapter models one browser slot with same-key `videoId + lang + caption-mode` single-flight, per-subscriber cancellation and deadline handling, underlying abort when all subscribers leave, and generation-based stale-response discard. Cache eligibility is a pure boundary and writes only validated structured success under `browser-native:v1`; it does not mutate the existing production `v=1` namespace.

### Tests and validation

- Added deterministic Vitest coverage for eligible/non-eligible triggers, response mapping, sanitized diagnostics, disabled-by-default behavior, duplicate coalescing, slot rejection, cancellation propagation, all-subscriber abort, deadline timeout, stale-response discard, executor cleanup failure, malformed/empty responses, and cache eligibility.
- Validation result: focused Vitest `36/36` passed; `npx tsc -b --pretty false` passed; targeted ESLint on the two new files passed with no errors; and `git diff --check` passed with existing Windows line-ending/config-ignore warnings.
- Real browser, YouTube, Linux/Xvfb, cloud, production, and server tests were intentionally not run. The future Linux/Xvfb real-service gate remains a single batched lifecycle on a separate 4 GiB+ host with two accepted positive controls; the destroyed DigitalOcean VM remains complete and will not be recreated.
- Existing production behavior remains unchanged because no application provider call site was modified.

### Evidence and state boundary

- This cycle provides local TypeScript contract/orchestration evidence only. It does not establish Linux browser behavior, service capacity, production recovery rate, pricing, or deployment readiness.
- No host was created or reused; no system package was installed; AWS/Vercel/Worker/VPS/production were untouched; no commit, push, or deploy occurred.

## 2026-09-04 ECHO-20260904-1200 - Linux/Xvfb pilot SSH access blocker

### Preflight and boundary

- User supplied the new separate validation VPS `170.64.184.233` and authorized installation only on that host. The previously established project identity path was checked without reading key contents.
- SSH reached the supplied address, but `ubuntu@170.64.184.233` and the single bounded `root@170.64.184.233` retry both returned `Permission denied (publickey)` using that same established key.
- No authenticated remote command ran. Therefore no host baseline, package/runtime availability, headed/Xvfb setup, browser run, resource/network telemetry, cancellation, cleanup, restartability, or privacy evidence exists for this cycle.

### State and next action

- No remote mutation, package installation, EchoLearn deployment, production AWS/Vercel/Worker/VPS mutation, commit, push, or deploy occurred. Production AWS `3.107.69.57` was not contacted.
- Host lifecycle state: user-reported created; SSH authentication unresolved; no destruction action taken. `USER_MAY_DESTROY_HOST=false` because only the user may authorize destruction.
- Genuine blocker: provide the correct authorized SSH identity and login user for `170.64.184.233` or perform the manual access correction. After access is supplied, run the full one-host Linux/Xvfb checklist in one lifecycle without recreating the prior DigitalOcean VM.
- Local implementation and mock gates remain accepted from prior cycles. This cycle produced no new browser or server evidence.

## 2026-09-04 ECHO-20260904-1152 - mocked browser fallback orchestration

### Scope and implementation

- Added `src/services/browserFallbackOrchestrator.ts`, a local-only controller over `BrowserFallbackAdapter`. It is not imported by `youtubeTranscript.ts`, Worker code, Vercel code, VPS code, or any production route.
- The controller models normal-provider outcome -> pure eligibility decision -> optional browser request -> unified transcript outcome and cache decision. Normal success and definitive semantic/user-controlled failures pass through unchanged in meaning and do not invoke browser or cache.
- Eligible `provider_timeout`, `provider_failure`, `network_failure`, and `upstream_5xx` outcomes can invoke the explicitly enabled isolated controller. Browser success is normalized to the unified transcript shape and is cache-eligible only after adapter validation under the separate `browser-native:v1` namespace.
- Browser timeout/failure/resource/slot/cleanup/invalid/partial/no-caption/player-blocked outcomes remain typed failures. Cancellation, deadline, stale generation, and duplicate same-key requests propagate through the adapter; duplicate requests share one execution and never launch a second browser slot.

### Behavior validation

- Added deterministic controller tests with fakes only, including the sequence `provider_timeout -> browser success -> unified usable transcript/cache decision` and `captions_not_found -> no browser call -> preserved truth`.
- Focused adapter + orchestration Vitest: **54/54 passed**.
- `npx tsc -b --pretty false`: passed.
- Targeted ESLint on the adapter, controller, and two focused test files: passed with no errors.
- `git diff --check`: passed with existing Windows line-ending/config-ignore warnings.
- No real browser, YouTube, target video, broad matrix, Linux/Xvfb, cloud, production, or full application suite was run. Existing transcript production-path tests were not rerun because no live provider boundary was modified.

### Stage decision and evidence boundary

- The local mocked-orchestration stage is **complete**. There is no remaining high-value local-only prerequisite before real-service validation; the next mandatory gate is one future batched separate >=4 GiB Linux/Xvfb host lifecycle.
- That future lifecycle must cover headed semantics, about:blank cleanup/resource checks, two accepted positive controls, media blocking, telemetry, cancellation/timeout, orphan detection, and >=25% memory headroom. Do not recreate the destroyed DigitalOcean VM or use the production AWS host.
- This cycle is local TypeScript/mock evidence only. No host was created or reused, no infrastructure or system package was changed, and no AWS/Vercel/Worker/VPS/production/GitHub state was mutated. No commit, push, or deploy occurred.

## 2026-09-04 ECHO-20260904-1218 - Linux headed/Xvfb pilot and bootstrap-aware M7 diagnostic

### Host and runtime

- SSH access was restored using the established local key path without reading or printing its contents. The supplied host was confirmed as the separate validation VPS `170.64.184.233`, hostname `ubuntu-s-2vcpu-4gb-syd1`; production AWS `3.107.69.57` was not contacted.
- Host baseline: Ubuntu 24.04.4 LTS, Linux 6.8.0-124-generic x86_64, 2 vCPU (`DO-Regular`), `4,106,100,736` total RAM bytes, no swap, and approximately `80 GB` disk. Chromium `152.0.7977.64` from `/snap/bin/chromium`, Xvfb, task-owned Node `22.14.0`/npm `10.9.2`, and `playwright-core 1.62.1` were installed/configured on this host only. System Node `18.19.1`/npm `9.2.0` were left unchanged.
- The runner launched external headed Chromium under Xvfb with no headless flag, a fresh disposable logged-out profile, loopback-only CDP, Playwright `connectOverCDP`, and media/video blocking. No EchoLearn production service was deployed.

### Bootstrap-aware diagnostic result

- The one bounded diagnostic first opened a natural first-party anonymous YouTube guest page in the fresh profile, waited for the bounded bootstrap window, and then navigated to M7 `M7lc1UVf-VE`. Bootstrap completed; the initial cookie count was `0`, the in-memory post-bootstrap count was `9`, and the profile was deleted during cleanup. No cookie values, visitor data, tokens, auth material, headers, request bodies, URLs, or caption text were persisted.
- Bootstrap traffic telemetry was aggregate-only: `131` requests and `3,914,144` encoded bytes; media `10 / 0` bytes and other `121 / 3,914,144` bytes. For the subsequent M7 navigation: `186` requests and `4,439,044` encoded bytes; caption `0 / 0`, media `10 / 0`, other `176 / 4,439,044`.
- M7 remained **`PLAYER_BLOCKED`**, reason **`player status LOGIN_REQUIRED`**; player duration and caption-track count were absent, with `0` timedtext responses, `0` parsed events/segments/usable lines. Latency including bootstrap was `18,160 ms`. This materially distinct bootstrap did not change M7 status or caption capture, so it is recorded as server/egress/video-specific evidence rather than a harness defect. No second positive or mini-matrix was run after this terminal diagnostic.

### Resource, cleanup, and acceptance

- The M7 diagnostic collected `68` valid process-tree samples with `0` sample failures. Peak full Chrome descendant tree: `1,897,988,096` working-set bytes, `809,574,400` private bytes, `13` processes, and `2,200` aggregate CPU ticks. Host memory after the run was `3,436,810,240` available bytes of `4,106,100,736` total (`>25%`); no swap/OOM was observed. The peak working set was below `75%` of host total.
- M7 cleanup passed: disposable profile removed, profile-associated process count `0`, orphan process count `0`. A final read-only host check found no Xvfb/Chromium process or disposable pilot profile. The earlier same-host pilot had already passed three about:blank smokes, a distinct accepted positive with structured captions and media `0`, cancellation cleanup, and restartability; those checks were not repeated after the terminal M7 diagnostic.
- Acceptance: headed/Xvfb semantics **PASS**; valid telemetry/headroom **PASS**; media transfer **0 bytes** **PASS**; bootstrap completion **PASS**; M7 real positive **FAIL** (`LOGIN_REQUIRED`); two-positive gate **NOT ACCEPTED**; bootstrap-aware M7 cleanup **PASS**; server pilot overall **NOT ACCEPTED** because the required M7 positive did not capture structured captions. This is local/isolated validation-host evidence only and makes no production or cost claim.

### Sanitized evidence and state

- Sanitized evidence was written on the validation host and copied locally to `D:\CODE\API\echolearn\evidence\ECHO-20260904-1218-bootstrap`. Manifest SHA-256: `2e38f728596a7dc2f820e3d8305628f44a682423112d383dcb0ed0b83dec8ba5`. Local checksum file SHA-256: `b5435be8a5e81628510d58d74de83b4ec3ec2d69512c089b9cfbe3a8bfc848e0`.
- The validation VPS remains running and was not destroyed. High-value host checks that do not depend on M7 are complete; the required real-service gate is terminally unaccepted for this bounded bootstrap axis. No further same-host identity/flag tuning or yt-dlp/session-token experiment is justified without a new explicit decision. `HOST_MAY_BE_DESTROYED=false` for Codex; user-only lifecycle decision remains pending.
- Local repo remained on `main`, `HEAD=6616139a0810f45b09c5c232054fa6860c9c4aa3`, matching `origin/main`. Existing unrelated dirty/untracked work was preserved. No commit, push, deploy, production integration, AWS/Vercel/Worker/VPS production mutation, or paid infrastructure action occurred.

## 2026-09-04 ECHO-20260904-1258 - different-egress/service-class decision research

### Checkpoint and scope

- Re-anchored the repository at branch `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; existing dirty and untracked work was preserved. Read the current browser fallback contract/orchestrator, production client cascade, Vercel/Worker/VPS boundaries, and current progress/report/decision/journal entries.
- No YouTube request, vendor account, proxy purchase, infrastructure creation, production request, deployment, commit, or push occurred in this cycle. This is architecture research, not provider success evidence.

### Evidence synthesis

- The strongest causal signal remains: local residential headed Chrome captured M7 captions, while the separate Linux datacenter VPS remained `LOGIN_REQUIRED` even after natural anonymous guest bootstrap. Public project evidence is consistent but not quantitative: the `youtube-transcript-api` README says cloud-provider IPs are commonly blocked and recommends rotating residential proxies, but warns that proxies do not guarantee success. Its open [POST-429 rotation issue](https://github.com/jdepoix/youtube-transcript-api/issues/612), [residential-proxy failure report](https://github.com/jdepoix/youtube-transcript-api/issues/421), and [PoToken-required report](https://github.com/jdepoix/youtube-transcript-api/issues/592) show that a residential label or IP rotation does not prove reliable caption access. No audited cross-provider success rate for M7 was found.
- YouTube's current [Terms of Service](https://uk.youtube.com/t/terms) restrict automated access except for stated exceptions such as prior written permission or applicable law. The official [Captions API](https://developers.google.com/youtube/v3/docs/captions/list) requires OAuth scopes and is designed around authorized caption resources; it is not a general anonymous transcript API for arbitrary public videos. Legal/compliance review is therefore a release prerequisite for every unofficial browser/proxy/vendor path.

### Bounded category comparison

| Category | M7-recovery evidence | Fit with current browser path | Main risks | Decision |
|---|---|---|---|---|
| Dedicated browser service + permitted rotating residential/ISP egress | Directionally strongest: changes the observed datacenter variable, but no public M7 rate and residential failures are documented | Highest. Reuses headed Chrome, guest bootstrap, CDP, request interception, structured timedtext parsing, and media blocking. Keep one stable exit for the session; rotate only between independent jobs | Proxy/AUP/ToS approval, variable IP reputation, bandwidth billing, own browser operations, no guarantee against player or video restrictions | **First validation candidate** |
| Managed remote browser/BaaS | Browserbase and Browserless document CDP/Playwright and proxy support, but neither supplies audited M7 caption results | Technically plausible; route interception can remain in the Playwright session, but provider telemetry and retention must be verified | Browserbase documents proxy restrictions including streaming; BaaS may retain sessions/replays; vendor egress and target-policy coupling; browser-time + proxy-byte billing | **Conditional second choice** |
| Transcript/caption vendor/API | API docs expose native-vs-generated modes and simple per-request/credit models, but public claims are vendor evidence, not M7 proof | Lowest implementation/ops burden; native-only mode could preserve caption semantics if enforced | Opaque upstream/egress, cannot independently prove `media=0`, possible hidden ASR fallback, video-ID/request retention, vendor ToS and availability dependency | **Conditional third choice; not ready** |

### Current pricing/traffic model (no purchase or cost forecast)

- Proxy category is generally bandwidth-priced with possible monthly minimums: current official examples show [Webshare rotating residential](https://www.webshare.io/residential-proxy) at 10 GB for `$27.50` and 25 GB for `$65`, and [Decodo residential](https://decodo.com/proxies/residential-proxies/pricing) at 3 GB for `$3.75/GB` and 10 GB for `$3.50/GB` plus VAT. These are observed list prices only, not an EchoLearn cost estimate.
- BaaS adds session time and proxy traffic: [Browserbase pricing](https://www.browserbase.com/pricing) lists a `$20/month` Developer tier with 100 browser hours and 1 GB proxy allowance, with overages; [Browserless pricing and unit docs](https://www.browserless.io/pricing) meter browser time in 30-second units and residential traffic at 6 units/MB. Browserbase also documents proxy restrictions that include streaming, while Browserless documents residential/external proxies and a Google/YouTube-oriented proxy preset. These pages do not establish caption success.
- Transcript vendors are request/credit-priced: [Supadata](https://supadata.ai/pricing) lists 100 free credits, 300 for `$5`, and 3,000 for `$17`, with one native transcript costing one credit and generated transcript minutes costing more; [YouTubeTranscript.dev](https://www.youtubetranscript.dev/pricing) lists 1,200 credits for `$9` and 4,000 for `$29`; [TranscriptAPI](https://transcriptapi.com/) lists `$5/month` for 1,000 credits and one credit per successful request. TranscriptAPI's [privacy policy](https://transcriptapi.com/privacy/) states that requested video IDs, request parameters, performance/usage data, and error logs may be collected, with usage logs retained up to one year. No vendor was contacted or used.

### Decision and minimum next experiment

- **Recommended:** keep the existing option-A dedicated single-concurrency browser fallback, but test only a contract-permitted rotating residential/ISP egress class next. Use a sticky exit for the natural bootstrap plus watch session, fresh logged-out profile, no imported cookies, no CAPTCHA/login automation, and the existing media block. This offers the best observability and the clearest way to verify browser-native `media=0`; it remains a hypothesis, not a production guarantee.
- **Backup:** a managed BaaS provider only after written confirmation that the target/use case is allowed, the exact egress can be selected, streaming restrictions do not apply, session/replay retention can be disabled or bounded, and raw CDP/network interception plus media blocking work. A transcript vendor is acceptable only after native-only behavior, no audio/ASR fallback, error mapping, retention, and M7 capability are contractually demonstrated.
- **Do not recommend now:** browser-first acquisition, static/datacenter proxy rotation, Bright Data residential for this use case while its [AUP](https://brightdata.com/acceptable-use-policy) prohibits streaming-related domains, or any vendor whose success claim cannot be tied to a controlled M7 probe.
- Minimum future experiment, not run here: one new egress class and one fresh bootstrap-aware M7 request; no retry. Require player `OK`, caption track present, non-empty structured timedtext, media encoded bytes `0`, aggregate request/network telemetry, resource/headroom and deterministic cleanup. Only if M7 succeeds, run one distinct already-accepted positive; require both positives before any isolated service integration. If M7 remains blocked, stop and classify the result without changing identity, flags, cookies, tokens, or yt-dlp behavior.

### Evidence boundary and state

- This cycle supplies current public documentation/project-issue evidence and a product decision only. It does not establish any provider's M7 success rate, YouTube permission, production reliability, pricing for EchoLearn, or media-byte behavior. Existing real Linux M7 evidence remains the strongest server-side observation: `LOGIN_REQUIRED` after natural bootstrap.
- Browser fallback remains disabled and unreferenced by production call sites. The validation VPS remains running and unchanged since the prior pilot; production AWS/Vercel/Worker/VPS production state was untouched. No commit, push, deploy, vendor account, or infrastructure mutation occurred.

## 2026-09-04 ECHO-20260904-1326 - residential egress pre-purchase readiness

### Scope and checkpoint

- Re-anchored the local repository at branch `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; all pre-existing dirty and untracked work was preserved. Read the active D-009 decision, current progress/report/journal entries, the disabled browser fallback contract/orchestrator, the production caption cascade boundaries, and the Linux headed/CDP pilot.
- This cycle did not contact `170.64.184.233`, create or mutate infrastructure, send proxy or YouTube traffic, access production, create an account, purchase a plan, or handle provider credentials. The prior DigitalOcean VM remains correctly destroyed and was not recreated.

### Current external evidence and candidate screen

- YouTube's [Terms of Service](https://uk.youtube.com/t/terms) restrict automated access except for stated exceptions such as written permission or applicable law, and the official [Captions API](https://developers.google.com/youtube/v3/docs/captions/list) is designed around authorized caption resources. Every unofficial browser/proxy path therefore requires a separate legal/compliance decision; a proxy vendor's AUP cannot grant YouTube permission.
- The project-level signal remains directional: the [`youtube-transcript-api` README](https://github.com/jdepoix/youtube-transcript-api) describes cloud-provider blocking and recommends rotating residential proxies, while its open [POST-429 rotation issue](https://github.com/jdepoix/youtube-transcript-api/issues/612), [residential failure report](https://github.com/jdepoix/youtube-transcript-api/issues/421), and [PoToken issue](https://github.com/jdepoix/youtube-transcript-api/issues/592) show that a residential label or rotation is not an M7 success guarantee. No audited provider-by-provider M7 success rate was found.
- **Preferred candidate - IPRoyal rotating residential:** its current [AUP](https://iproyal.com/acceptable-use-policy/) prohibits unlawful/unauthorized, rights-infringing, protected/non-public, excessive, or abusive use but the reviewed public AUP did not name streaming as an explicit residential prohibition. Its official [residential documentation](https://docs.iproyal.com/proxies/residential) lists HTTP(S)/SOCKS5, 195+ country coverage, rotation or sticky sessions up to 7 days, username/password or IP allowlisting, and pay-as-you-go traffic; the current [pricing page](https://iproyal.com/pricing/residential-proxies/) shows a 1 GB entry at `$7/GB` (list price observed, not an EchoLearn cost estimate). The [high-end pool documentation](https://docs.iproyal.com/proxies/residential/proxy/high-end-pool) uses a `_streaming-1` configuration, but that label is not written permission for this use case. IPRoyal's [privacy policy](https://iproyal.com/privacy/) describes collection of account/system and traffic-related log data, so retention, target-domain visibility, and a suitable DPA must be confirmed before use.
- **Backup - Decodo rotating residential:** its official [restricted-target documentation](https://help.decodo.com/docs/residential-proxy-restricted-targets) and [FAQ](https://decodo.com/faq/general/do-you-have-any-blocked-sites) explicitly classify streaming as restricted; the FAQ says it may be unblocked after ID verification for rotating residential and not static residential/ISP. Its [quick start](https://help.decodo.com/docs/residential-proxy-quick-start) provides HTTP/HTTPS/SOCKS5 and sticky sessions up to 24 hours; its [pricing](https://decodo.com/proxies/residential-proxies/pricing) shows 3 GB at `$3.75/GB` and 10 GB at `$3.50/GB` plus VAT, with a 3-day trial described in the public FAQ. It is usable for a future probe only after explicit written approval for YouTube caption-only browser access and confirmation of retention/logging.
- **Additional conditional alternative - Webshare rotating residential:** current [restricted-target guidance](https://help.webshare.io/en/articles/10068143-restricted-websites-on-our-rotating-residential-proxy-network) explicitly lists streaming platforms and directs the customer to compliance; its [endpoint generator](https://help.webshare.io/en/articles/16310718-endpoint-generator-rotating-residential) supports HTTP/SOCKS5, country/ASN targeting, and sticky sessions from 1 minute to 24 hours. Its current [pricing](https://www.webshare.io/residential-proxy) lists 10 GB at `$27.50` and 25 GB at `$65`. It is not preferred without written approval. Oxylabs was screened out on the same basis because its official [restricted-target documentation](https://developers.oxylabs.io/proxies/residential-proxies/restricted-targets) also lists entertainment/streaming and requires customer-success confirmation.
- Candidate status is therefore: IPRoyal **best public-policy fit but still written-confirmation required**; Decodo **backup after restricted-target approval/KYC**; Webshare **additional fallback after compliance approval**; Bright Data **excluded** while its [AUP](https://brightdata.com/acceptable-use-policy) prohibits streaming-related domains. None supplies audited M7 caption evidence in the reviewed material.

### Local harness proxy readiness

- Added `scripts/local-native-youtube/proxy-config.mjs` and `proxy-config.test.mjs`. `linux-pilot.mjs` now reads proxy settings only from environment, adds only the credential-free endpoint to Chromium's `--proxy-server` argument, removes proxy username/password from the Chromium child environment, and handles only proxy auth challenges through the CDP Fetch domain. Non-proxy auth challenges are cancelled. The evidence payload records only `{ configured, protocol, authConfigured }`; it never records endpoint, username, password, headers, cookies, tokens, raw URLs, or caption text.
- Supported input is an explicit `http://`, `https://`, or unauthenticated `socks5://` endpoint with host and port. Credentials embedded in the endpoint, partial credentials, line breaks, unsupported protocols, and authenticated SOCKS5 are rejected with fixed diagnostic codes. Authenticated SOCKS5 is intentionally not claimed because this external-Chrome seam has no secure credential channel for it; use HTTP(S) for the future pilot unless a separately reviewed mechanism is added.
- The existing headed/Xvfb launch, loopback CDP, fresh logged-out profile, media/video interception, Network encoded-byte telemetry, process-tree telemetry, cleanup, and production-disabled architecture remain intact. No production call site imports or invokes this runner or its proxy helper.

### Minimum user input and one future run shape

- User/provider must supply only: provider and product tier; written permission/approval for this YouTube automated browser/caption-only use; a provider-generated endpoint without embedded credentials; username/password through a secret channel (or an approved IP allowlist); selected country/region/ASN; sticky-session identifier/TTL semantics; and retention/logging/DPA confirmation. Do not supply a private key, YouTube login, cookies, visitor data, PoToken, or audio/ASR permission.
- The exact Linux command shape is below. The secret file is an operator-provided protected file and the values shown are placeholders only; do not paste real credentials into chat, logs, evidence, Git, or shell history:

```sh
set -a
. /run/secrets/echolearn-proxy.env
set +a
ECHOLEARN_BOOTSTRAP_M7_ONLY=1 \
ECHOLEARN_PILOT_EVIDENCE=/root/echolearn-pilot/evidence/ECHO-20260904-egress-m7 \
node scripts/local-native-youtube/linux-pilot.mjs
```

The protected env file has this shape, with no real values in this report:

```dotenv
ECHOLEARN_PROXY_SERVER=http://proxy.example.invalid:PORT
ECHOLEARN_PROXY_USERNAME=PROVIDER_USERNAME
ECHOLEARN_PROXY_PASSWORD=PROVIDER_PASSWORD
```

The runner's current `ECHOLEARN_BOOTSTRAP_M7_ONLY=1` path performs exactly one natural guest-bootstrap-aware M7 attempt. If and only if it returns player `OK`, a caption track, non-empty structured timedtext, media encoded bytes `0`, valid resource/headroom telemetry, and deterministic cleanup, run one distinct accepted positive in a separate fresh profile. No retry, matrix, or provider rotation is authorized by this pre-purchase decision.

### Decision and evidence boundary

- **Recommended:** proceed only to one user-approved IPRoyal rotating-residential capability probe, using a sticky exit for the natural bootstrap plus watch session and the current browser-native media-blocked harness. This is the smallest experiment that changes the observed datacenter egress variable while preserving browser semantics and measurable `media=0`.
- **Backup:** Decodo rotating residential after written streaming-target approval/KYC; Webshare after equivalent compliance approval. Managed browser/transcript vendors remain conditional alternatives requiring separate native-only, retention, media, and M7 capability evidence.
- **Not recommended:** browser-first routing, static/datacenter rotation, Bright Data for this use case, login/cookie/PoToken/yt-dlp tuning, or any provider whose policy or retention is unclear.
- This cycle establishes **local harness readiness only**. Provider credentials, real proxy connectivity, M7 recovery, actual cost/traffic, YouTube permission, production reliability, and production integration remain unverified. Production remains unchanged.

### Validation actually run

- Passed local-only validation after the proxy seam: focused Vitest for caption parser, network telemetry, and proxy config (**25/25**); `node --check` for the runner and helper; targeted ESLint for the runner/helper/test; `npx tsc -b --pretty false`; `git diff --check`; and static `rg` search confirming the proxy helper/runner are confined to the local pilot directory and no production call site references them. No full app suite, live provider test, VPS/SSH check, or YouTube request was run.

## 2026-09-04 ECHO-20260904-1438 - local Proxy-Cheap prerequisite hardening

### Scope and implementation

- Local-only changes hardened `scripts/local-native-youtube/linux-pilot.mjs` without contacting the validation VPS or any provider. New `pilot-contract.mjs` and deterministic tests define the allowlisted `full`, `m7-only`, and `distinct-positive-only` modes, exact sanitized M7 manifest/hash prerequisite, fail-if-present evidence claim, one global deadline, unprivileged sandbox policy, observed-PID ownership, bootstrap/watch semantics, strict M7/positive acceptance, and privacy-safe salted coarse proxy-exit proof validation.
- The runner now has explicit CDP phase transitions: ending bootstrap drops late events and disables Network, then a separate `Network.enable` is awaited before the M7 epoch begins. Timedtext response state is epoch-separated as well. The runner loads one `before` observation before the job, loads a separate `after` observation only after M7 capture/cleanup, and binds them by checkpoint time; a precomputed pair or an after timestamp before M7 fails closed. No IP-check request was made.
- Evidence output is unique/fail-if-present with a default under unprivileged `os.tmpdir()`. Proxy credentials are removed from Chromium and Xvfb child environments, including standard proxy variable names. Root/`--no-sandbox` is an explicit non-eligible compatibility path; the intended gate requires an unprivileged user with Chromium sandbox enabled. Process cleanup retains initially and subsequently observed descendants to cover reparented children.
- `browserTranscriptFallback.ts` now rejects success without native-caption/no-ASR, player/track/language, structured timedtext, non-partial, zero-media, zero-malformed, and cleanup-success truth. Known-track empty responses map to `provider_failure`, cache eligibility requires the same validated diagnostics, orchestration failures retain `upstreamCode`, and request-scope generations protect cross-video late results. The seam remains disabled and unreferenced by live production paths.

### Deterministic validation

- `npx vitest run --config scripts/local-native-youtube/vitest.config.mjs`: **38/38 passed** across 4 files.
- `npx vitest run src/services/__tests__/browserTranscriptFallback.test.ts src/services/__tests__/browserFallbackOrchestrator.test.ts`: **57/57 passed**.
- `node --check` passed for `linux-pilot.mjs`, `pilot-contract.mjs`, and `telemetry.mjs`; `npx tsc -b --pretty false` passed; targeted ESLint for changed harness/service files passed with no errors; `git diff --check` passed with existing line-ending/config-ignore warnings.
- Static production-reference search found only the isolated fallback module/tests and local pilot assets; no live YouTube, Worker, Vercel, VPS, or application acquisition call site invokes the new seam.

### Readiness and evidence boundary

- This local prerequisite gate is **READY for one bounded real Proxy-Cheap M7 capability probe**, subject to provider written-use/policy confirmation and user-supplied credentials through a secret channel. It is **NOT** production-integration approval and does not prove residential-class reliability; egress remains a hypothesis and a future one-exit result is only a capability result.
- No proxy credentials, provider account, purchase, proxy request, YouTube request, SSH/VPS action, infrastructure mutation, production mutation, commit, push, or deploy occurred in this cycle. The prior validation VPS `170.64.184.233` was not contacted this cycle; production AWS/Vercel/Worker remain unchanged. The future real run must use distinct before/after checkpoint files and stop unless strict M7 passes.

## 2026-09-04 ECHO-20260904-1514 - Proxy-Cheap capability gate access checkpoint

### Scope and host preflight

- Re-anchored local `main`: `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; existing dirty and untracked work was preserved and no files were staged. No reset, clean, stash, commit, push, deploy, or production mutation occurred.
- Read-only SSH to the separate validation VPS `170.64.184.233` succeeded as root. Baseline: Ubuntu 24.04.4, kernel `6.8.0-124-generic`, 2 vCPU, total RAM `4,106,100,736` bytes, available RAM `3,587,674,112` bytes, swap `0`, root disk total `82,086,711,296` bytes with `77,488,017,408` bytes available; Chromium `/snap/bin/chromium` `152.0.7977.64`, Xvfb `/usr/bin/Xvfb`, Node `18.19.1`, npm `9.2.0`. The host is the validation VPS, not production AWS `3.107.69.57`.
- A safe local source-name audit found no `ECHOLEARN_PROXY_SERVER`, `ECHOLEARN_PROXY_USERNAME`, `ECHOLEARN_PROXY_PASSWORD`, or Proxy-Cheap credential source. The only matching configured application key was `.env.production` `VITE_YOUTUBE_PROXY`; its code contract is an existing application proxy base URL, not Proxy-Cheap credentials, so it was not used.

### Gate result

- M7: **NOT RUN (0 attempts)** because the required Proxy-Cheap credentials were unavailable. Distinct positive: **NOT RUN (0 attempts)** and remained correctly mode/manifest gated. No proxy or YouTube request was sent.
- Because no browser job ran, this cycle has no new latency, Node RSS, Chrome-tree working-set/private/process, host headroom-at-peak, encoded-network-category, media-zero, cleanup/orphan, cancellation, or restartability measurements. The earlier local/Linux direct-egress evidence remains historical and is not relabeled as Proxy-Cheap evidence.
- No packages/runtime/configuration were installed or changed on the VPS. No evidence directory or raw/secret data was created. The host remains running and was not destroyed; Codex advises `HOST_MAY_BE_DESTROYED=false` until the user resolves credentials and completes the bounded gate.

### Next gate

After policy-approved secret-channel credential delivery and a safe temporal observation mechanism, reuse this same VPS for one fresh `m7-only` run: load `before` before guest bootstrap/M7, obtain/load `after` only after M7 acquisition and cleanup, require strict M7 acceptance plus stable residential/ISP proof, media encoded bytes `0`, resource headroom, cleanup, and privacy. Only if that passes may the exact manifest/hash-gated distinct-positive run occur. Production browser fallback remains unapproved.

## ECHO-20260904-1617 - ScrapingBee dedicated YouTube subtitles bounded capability gate

### Scope and result

- Inspected the existing `cf-worker/src/scrapingbeeYoutubeSubtitles.js`, its declaration, deterministic test file, and local evaluator. The adapter uses only ScrapingBee's dedicated YouTube Subtitles endpoint class with Bearer auth and `video_id`; no HTML scraping API, proxy, residential egress, VPS, deployment, account creation, or account mutation was used.
- Safe presence-only inspection of existing project env/config files and process/user/machine environment scopes found no non-empty ScrapingBee/SCRAPE_API_KEY-style credential. Per the stop rule, the official API was not called.
- Candidate decision: **INCONCLUSIVE**, not provider NO-GO. M7 `M7lc1UVf-VE` requested English: **NOT RUN, 0 attempts**. Conditional hard target `YweN5PUyGgc`: **NOT RUN, 0 attempts**. Exact real requests: **0**. Approximate credits at 5 credits/request: **0**.

### Evidence boundary

- No current-cycle HTTP status, structural timestamped-segment count, latency, compatible-language result, or no-subtitles/unavailable distinction was produced. No transcript text, raw response body, credential, cookie, or secret was printed, logged, persisted, or added to evidence.
- The existing adapter had no clearly demonstrated local schema bug that required a bounded change before the official request; no code change was made. DigitalOcean `170.64.184.233` is not needed for this direct managed-provider validation path.

### Deterministic validation actually run

- `npx vitest run src/services/__tests__/scrapingbeeYoutubeSubtitles.test.ts`: **12/12 passed**.
- Targeted ESLint for the adapter, adapter test, and ScrapingBee evaluators: passed with no errors.
- `npx tsc -b --pretty false`: passed.
- `git diff --check`: passed; output contained only the repository's existing LF/CRLF conversion warnings.
- No live provider request, broad suite, browser verification, VPS/SSH action, production check, commit, or push was performed.

### Next step

Resolve the exact missing-credential blocker through an already-existing authorized ScrapingBee account/key and a protected process-environment injection. Then run exactly one bounded English M7 request; run the hard target only if M7 strictly succeeds.

## ECHO-20260904-1617 - ScrapingBee dedicated YouTube subtitles real-provider result

### Bounded real-provider result

- The protected local secret file was validated as a non-empty single-line credential and injected only into the child process environment. It was not printed, echoed, hashed, persisted, modified, or included in any command argument, log, evidence, or documentation.
- Using only the existing dedicated adapter/evaluator path, exactly one official `/api/v1/youtube/subtitles` request was made for M7 `M7lc1UVf-VE`, requested language `en`, with the existing Bearer-auth path and approximately 12-second timeout. Sanitized result: status class **`4xx`**, typed outcome **`provider_failure`**, latency **2,228 ms**, structural timestamped segments **0**, non-empty timestamped segments **0**, returned language **`none`**, requested/returned language compatible **false**.
- M7 failed the strict acceptance gate. The exact status code was intentionally not retained; the non-2xx result was sufficient to stop. `YweN5PUyGgc` was correctly gated and not requested.
- Exact live requests: **1**. Approximate credits at 5 credits/request: **5**. Candidate decision: **NO-GO for this configured credential/provider check**. No retry, key rotation, account change, proxy, browser, VPS, DigitalOcean, production, deployment, commit, or push action occurred.

### Code and evidence boundary

- No local adapter schema bug was exposed: the live response was non-2xx, so no official response body was accepted for parsing. No code or deterministic test changes were needed.
- No raw response/body, transcript text, API key, cookies, or unrelated secret was printed, logged, persisted, or included in the report. DigitalOcean `170.64.184.233` is not needed for this direct managed-provider path.

### Deterministic validation after the live attempt

- `npx vitest run src/services/__tests__/scrapingbeeYoutubeSubtitles.test.ts`: **12/12 passed**.
- Targeted ESLint for the adapter, adapter test, and ScrapingBee evaluators: passed with no errors.
- `npx tsc -b --pretty false`: passed.
- `git diff --check`: passed with the repository's existing LF/CRLF conversion warnings only.

### Terminal state

The approved bounded sequence is terminal for this checkpoint: M7 failed with a 4xx/provider failure and the hard target remained locked. Do not retry or rotate credentials under this task; any future account/provider diagnosis requires separate authorization.

## ECHO-20260904-1638 - DigitalOcean validation VPS lifecycle update

- The user explicitly confirmed destruction of DigitalOcean validation VPS `170.64.184.233`. No connection, recovery, recreation, or validation action against that VPS is permitted in this diagnosis cycle.

## ECHO-20260904-1638 - ScrapingBee bounded account/API diagnosis

### Lifecycle and usage diagnosis

- The user confirmed that DigitalOcean validation VPS `170.64.184.233` was destroyed. It was not contacted, recovered, recreated, or used.
- The protected credential was read only from the specified local secret file and injected into a child process environment. It was not printed, persisted, hashed, modified, or placed in command arguments.
- Exactly one official `GET /api/v1/usage` health check ran. Sanitized result: status `200`, status class `2xx`, auth classification `accepted_2xx`, `maxConcurrency=5`, `currentConcurrency=0`. Credit and renewal values were not retained by the one-shot safe extractor, so the required 5-credit minimum could not be established without violating the one-call budget.
- No YouTube request ran in this task. `rfscVS0vtbw` sample and M7 `M7lc1UVf-VE` without `language` were both gated. Exact YouTube requests: **0**; approximate YouTube credits: **0**. The prior task's M7 4xx therefore cannot be narrowed to 404 versus auth/access from this cycle.

### Bounded adapter correction

- The existing adapter previously mapped every non-2xx response to `provider_failure`. It now maps 401/403 to typed `auth_failure`, 404 to neutral typed `not_found` because the response cannot distinguish requested-language miss from target-level absence, and retains sanitized numeric HTTP status. Other non-2xx behavior remains provider failure; no production integration was added.
- Added deterministic coverage for 401, 403, and 404 mappings and response-body non-exposure. No live response body was persisted or used for the correction.
- Diagnosis result: **INCONCLUSIVE**. Usage authentication is accepted and concurrency is available, but subtitle endpoint entitlement/request semantics and credit sufficiency remain unverified.

### Validation actually run

- `npx vitest run src/services/__tests__/scrapingbeeYoutubeSubtitles.test.ts`: **13/13 passed**.
- Targeted ESLint for the adapter, declaration, adapter test, and ScrapingBee evaluators: passed with no errors.
- `npx tsc -b --pretty false`: passed.
- `git diff --check`: passed with existing LF/CRLF conversion warnings only.
- No sample/M7 request, browser/VPS action, production action, deployment, commit, push, vendor contact, plan purchase, or key rotation occurred.

### Root-cause boundary

The current evidence rules out an immediately rejected API key at `/usage` and current concurrency exhaustion. It does not establish remaining credits or whether the previous subtitles 4xx was the documented 404 language/availability result, so no provider capability conclusion is claimed.

## ECHO-20260904-1658 - Corrected ScrapingBee usage gate result

### Corrected usage check

- Before any real network call, the local-only usage helper was corrected to accept only finite numbers or canonical numeric strings, reject null/empty/whitespace/boolean/coercible invalid values, and return `null` for non-finite or negative computed remaining credits. Deterministic coverage was added.
- Exactly one non-billable official `GET /api/v1/usage` request ran with Bearer auth. Sanitized result: HTTP **200**, status class **`2xx`**, auth classification **`accepted_2xx`**, `max_api_credit=1000`, `used_api_credit=1010`, computed remaining **`null`** because used exceeded max, `max_concurrency=5`, `current_concurrency=0`, renewal date `2026-08-13T10:07:58.149206`.
- The key is accepted and concurrency is available, but the account balance is exhausted/overdrawn. The required `>=5` credit gate failed closed. The docs sample `rfscVS0vtbw` and M7 `M7lc1UVf-VE` without a language parameter were not requested.
- Exact billable YouTube requests: **0**. Approximate YouTube credits: **0**. Root-cause classification: **account credit exhaustion/overdraw**, not usage authentication or concurrency failure. The prior subtitles 4xx was not re-run and cannot be independently identified as 404 versus auth/access in this cycle.

### Code and validation

- Added local-only `scrapingbeeUsage.js`, declaration, evaluator, and focused tests. Updated the subtitle evaluator/adapter seam to support one explicit no-language request if a future credit-authorized run is separately approved. No production call site was changed.
- Focused Vitest for usage and subtitles: **19/19 passed**. Targeted ESLint passed, `npx tsc -b --pretty false` passed, and `git diff --check` passed with existing LF/CRLF warnings only.
- No sample/M7 request, proxy/browser/VPS action, production mutation, deployment, purchase/upgrade, vendor contact, key rotation, commit, or push occurred. DigitalOcean `170.64.184.233` remains destroyed and unused.

### Terminal diagnosis

ScrapingBee is **NO-GO for the current account until credits are replenished**. This is an account-balance gate, not sufficient evidence of subtitle endpoint capability; no provider plan change or account mutation was authorized.

## 2026-09-04 ECHO-20260904-1723 - Generic Linux browser runtime gate

### Host mutation and runtime

- On disposable validation VPS `134.199.155.9` only, installed Xvfb `2:21.1.12-1ubuntu1.6`, Node `v22.23.2`, npm/npx `10.9.8`, Chromium snap `152.0.7977.64`, and standalone Google Chrome `152.0.7977.82`; created unprivileged user `echolearnpilot` UID `1000`. No production/AWS/Vercel/Worker host was contacted.
- The Chromium snap wrapper exited under the non-interactive root-to-user launch with a snap cgroup error. This was diagnosed from temporary stderr and no residue remained. Standalone Google Chrome was used for the bounded generic smoke; no `--no-sandbox` flag was passed.

### Generic smoke evidence

- Two fresh disposable-profile cycles passed under Xvfb with headed Chrome semantics and loopback CDP. Both reported `about:blank` and `example.com` targets, removed the profile, and ended with zero task-owned Chromium/Xvfb/Node orphans.
- Cycle 1: 3 resource samples; peak Chrome-tree RSS-style working-set estimate `1,472,102,400` bytes, private bytes `275,099,648`, 17 processes. Cycle 2: 3 samples; peak working-set `1,495,740,416` bytes, private bytes `296,505,344`, 17 processes. Post-run host memory was approximately 3.3 GiB available of 3.8 GiB total, with 0 swap; root disk had approximately 72 GiB free.
- Final generic result: **PASS** for Xvfb start, unprivileged headed Chrome launch, CDP reachability, `about:blank`, `example.com`, cleanup, and restartability. Network request/category telemetry was not collected because this was a generic browser-only smoke, not the caption harness.

### Boundary and lifecycle

- No YouTube, transcript-provider, Proxy-Cheap, residential-proxy, cookie, login, token, ASR, audio, production, or AWS/Vercel/Worker request occurred. The intended direct-vs-residential YouTube experiment remains unexecuted; this generic result does not establish M7 capability or production readiness.
- Host remains running and was not destroyed. Infrastructure-only work is complete; recommendation: `HOST_MAY_BE_DESTROYED=true`, subject to the user's lifecycle decision. No local code changed; only durable project logs were updated. No commit, push, or deploy occurred.

## 2026-09-04 ECHO-20260904-1723 - Direct-vs-residential M7 host gate access blocker

### Preflight and access

- Local repository re-anchor: `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, existing dirty/untracked work preserved, no staged changes. No reset, clean, stash, commit, push, deploy, or production mutation occurred.
- New isolated validation VPS `134.199.155.9` was contacted only through the established SSH identity path. Both `root` and `ubuntu` failed with `Permission denied (publickey)`. No remote command ran after authentication failure; no baseline, package installation, runtime setup, upload, or host mutation was performed. Production AWS `3.107.69.57` was not contacted.
- The required local secret file `D:/CODE/API/echolearn/proxy-cheap-runtime.txt` was checked only for existence/size and was **absent**. No credential value was read, printed, hashed, included in a command line, or persisted.

### Gate result

- Direct M7: **NOT RUN (0 attempts)**; SSH access failed before setup. Proxy M7: **NOT RUN (0 attempts)**. Conditional distinct positive: **NOT RUN (0 attempts)**. No proxy/YouTube traffic was sent.
- No host resource, browser process-tree, encoded-network, media-zero, cleanup/orphan, restartability, or exit-proof measurements were collected for `134.199.155.9`. No M7 or egress conclusion is claimed.
- Validation run this cycle: local read-only git re-anchor/status, secret-file presence/size check, and two bounded SSH connectivity attempts. No focused tests were rerun because no code changed and the host gate was blocked. The existing local harness/service tests remain historical checkpoint evidence only.

### Lifecycle and next gate

- Host lifecycle: newly created/reused for this task, still running, not destroyed by Codex. Recommendation: `HOST_MAY_BE_DESTROYED=false` until access is repaired and the bounded comparison is completed.
- Next action requires the user to authorize the established key for `root` or `ubuntu` and make the already-configured runtime secret file available through the secret channel. Then use only this VPS for one direct M7 control followed by at most one Proxy-Cheap M7; no retry or conditional positive unless strict proxy M7 passes. Production integration remains unapproved.

## 2026-09-04 ECHO-20260904-1723 - Infrastructure continuation terminal closure

The preceding access-blocker section is retained as historical evidence from before SSH authorization was fixed. The continuation installed and validated the generic browser runtime on `134.199.155.9`; no YouTube, proxy, provider, or production request was made. Generic infrastructure work is complete, the host remains running and was not destroyed, and the current recommendation is `HOST_MAY_BE_DESTROYED=true`; the intended direct-vs-residential M7 experiment remains unexecuted.

## 2026-09-04 ECHO-20260904-2044 - Cycle 1 worktree hygiene and cache-aware measurement foundation

### Strategy baseline and repository anchor

- This cycle follows the completed Sol+xhigh strategic review. The review findings were independently checked against the current local source before any change: the local dirty set mixes production-sensitive Worker/VPS changes with operational checks, browser experiments, ScrapingBee experiments, and journals; the VPS hostname source fix is already present; the Worker cache marker exists but was not exposed through CORS; and the accepted 7/7 production evidence did not prove per-request cold `MISS`/`HIT` state.
- Local anchor verified before edits: branch `main`; `HEAD=6616139a0810f45b09c5c232054fa6860c9c4aa3`; `origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; ahead/behind `0/0`; no staged changes. The final review also confirmed the branch/HEAD remained unchanged.
- No live YouTube, provider, browser, SSH, network, production, Worker, Vercel, or VPS test ran. No package was installed; no infrastructure, account, spend, deployment, commit, push, reset, clean, stash, checkout-discard, move, or deletion occurred.

### Exact current dirty-file grouping and recommended disposition

The following is the complete non-ignored `git status --short --untracked-files=all` grouping at handoff. Existing files were preserved in place; the dispositions are review/commit-boundary recommendations only.

| Group | Exact files | Recommended disposition |
|---|---|---|
| Production-sensitive Worker | `cf-worker/src/index.js`; `src/services/__tests__/cfWorkerTranscript.test.ts` | Review as a narrow coordinated Worker source/test candidate. Keep separate from the VPS/browser/ScrapingBee experiments; do not deploy from this dirty set. |
| Production/security-sensitive VPS | `vps-ytdlp/main.py`; `vps-ytdlp/test_main.py` | Review as a separate VPS/security candidate. The exact-host source fix is locally confirmed and regression coverage was added; deployment and exploitability remain **UNKNOWN**. |
| Operational/health-check | `scripts/health-check.mjs`; `src/services/__tests__/healthCheck.test.ts` | Keep as monitoring-only work. Health success now reports cache/acquisition observability; fixed controls are not cold-acquisition proof. Live schedule/endpoint behavior remains deferred. |
| Browser experiment | `scripts/local-native-youtube/caption-parser.mjs`; `scripts/local-native-youtube/caption-parser.test.mjs`; `scripts/local-native-youtube/diagnose-external-chrome.mjs`; `scripts/local-native-youtube/diagnose-m7.mjs`; `scripts/local-native-youtube/linux-pilot.mjs`; `scripts/local-native-youtube/pilot-contract.mjs`; `scripts/local-native-youtube/pilot-contract.test.mjs`; `scripts/local-native-youtube/proxy-config.mjs`; `scripts/local-native-youtube/proxy-config.test.mjs`; `scripts/local-native-youtube/run-headed-matrix.mjs`; `scripts/local-native-youtube/telemetry.mjs`; `scripts/local-native-youtube/telemetry.test.mjs`; `scripts/local-native-youtube/vitest.config.mjs`; `src/services/browserFallbackOrchestrator.ts`; `src/services/__tests__/browserFallbackOrchestrator.test.ts`; `src/services/browserTranscriptFallback.ts`; `src/services/__tests__/browserTranscriptFallback.test.ts` | Keep paused/archive-only and unintegrated. Do not move, delete, or fold into the production acquisition cascade in this cycle. |
| ScrapingBee experiment | `cf-worker/src/scrapingbeeUsage.d.ts`; `cf-worker/src/scrapingbeeUsage.js`; `cf-worker/src/scrapingbeeYoutubeMatrix.d.ts`; `cf-worker/src/scrapingbeeYoutubeMatrix.js`; `cf-worker/src/scrapingbeeYoutubeSubtitles.d.ts`; `cf-worker/src/scrapingbeeYoutubeSubtitles.js`; `scripts/eval-scrapingbee-usage.mjs`; `scripts/eval-scrapingbee-youtube-matrix.mjs`; `scripts/eval-scrapingbee-youtube.mjs`; `src/services/__tests__/scrapingbeeUsage.test.ts`; `src/services/__tests__/scrapingbeeYoutubeMatrix.test.ts`; `src/services/__tests__/scrapingbeeYoutubeSubtitles.test.ts` | Keep paused/archive-only and unintegrated. No provider retry, account action, purchase, or production integration is justified by this cycle. |
| Documentation/journal | `DECISIONS.md`; `PROGRESS.md`; `TEST_REPORT.md` | Retain as durable records. The required ignored/local journal `.workbuddy/memory/2026-09-04.md` was also updated, but it is not a Git-status file. |
| Other / scoped Cycle 1 measurement foundation | `src/services/transcriptOutcomeMeasurement.ts`; `src/services/__tests__/transcriptOutcomeMeasurement.test.ts` | Keep as a small local pure helper/test candidate. Do not wire a remote analytics sink until the D-011 emission gate is satisfied. |
| Other/unrelated | None identified | No unrelated dirty file was changed or reclassified as in-scope. |

`src/services/cfWorkerTranscript.ts` does not exist in this checkout. The current frontend equivalent is `src/services/youtubeTranscript.ts`; it was inspected for the response-consumption boundary and was not changed because no cache-state consumer or measurement sink was authorized in Cycle 1.

### VPS hostname validation

- `vps-ytdlp/main.py` already parses `urllib.parse.urlparse(target_url).hostname`, lowercases it, accepts only `youtu.be`, `youtube.com`, and `*.youtube.com` for YouTube, and applies exact known-host checks in `_host_allowed`. This is the bounded local fix expected by the review; the prior broad substring implementation is not present in the current local dirty source.
- Added `HostValidationTests.test_youtube_validation_uses_exact_hosts_and_subdomains` to `vps-ytdlp/test_main.py`. It covers accepted root/subdomain/short-link hosts and rejects lookalike domains, suffix attacks, path/query-only mentions, and user-info host confusion.
- No source rewrite was made beyond the pre-existing local candidate. No deployment, production source comparison, exploitability probe, or active-service verification occurred in this cycle. Local source is verified; production VPS revision/config is **UNKNOWN** and remains unmodified.

### Worker cache-state and CORS contract

- The existing local Worker cache marker is now named `TRANSCRIPT_CACHE_HEADER` and is exposed through `Access-Control-Expose-Headers` alongside `X-EchoLearn-Trace-Id`, so browser JavaScript can read it from the Worker response.
- The existing semantics remain intact: valid caption cache response = `HIT`; a normal caption request that misses the cache and reaches acquisition = `MISS`; explicit ASR and debug/diagnostic paths = `BYPASS`. The canonical cache key still uses transcript version `v=1`; no namespace/version change was made.
- ASR success/error responses now carry the `BYPASS` marker as well as the existing trace header. This is response observability only; provider ordering, cache lookup/write behavior, and ASR opt-in behavior were not redesigned.
- Deterministic Worker tests prove cache `HIT`, normal acquisition `MISS`, explicit ASR `BYPASS`, top-level CORS preservation, allowed-origin handling, and exposure of both readable headers. No live Worker traffic or deployment ran.

### Privacy-safe measurement contract

- Added `src/services/transcriptOutcomeMeasurement.ts` with a pure bounded builder. The output contains exactly `outcomeCode`, `cacheState`, `latencyBucket`, `authState`, and `retryUsed`.
- Outcome codes are a fixed aggregate allowlist; cache state is `HIT`/`MISS`/`BYPASS`/`UNKNOWN`; auth state is `guest`/`authenticated`/`unknown`; latency is one of fixed buckets from `<1s` through `>=120s` or `unknown`. Invalid categorical values fail closed and unavailable/invalid timing becomes `unknown` without retaining raw duration.
- Deterministic tests prove exact output keys, bucket boundaries, unknown timing, bounded categorical coverage, invalid-value rejection, and absence of URL/video/content/provider/credential fields from serialized measurement output.
- `src/services/analytics.ts` was not wired to a new event. Exact deferred gate: choose one bounded transcript completion/failure emission point, prove cache/auth/retry state can be supplied without URL/video/content/provider data, then obtain the required privacy/product approval before enabling any remote aggregate event. D-011 records this decision.

### Health-check/evidence hygiene

- The dirty `scripts/health-check.mjs` controls use fixed known caption URLs. They remain availability checks and may be served from cache; a passing body validator alone is not fresh-acquisition evidence.
- Added bounded response classification: a Worker `HIT` is reported as `cache_hit`, `MISS` as `cache_miss_before_acquisition`, `BYPASS` as `cache_bypassed`, and a missing/invalid header as `UNKNOWN` / `not_observable`. The Vercel control therefore cannot be mislabeled as a cold miss when the header is absent.
- Deterministic health tests cover all marker classes, malformed/missing state, a `MISS` response without URL/body retention, and a fixed successful control with no cache header. No live health-check invocation ran; fresh behavior validation is deferred to Cycle 2.

### Validation actually run

- Focused Vitest: `npx vitest run src/services/__tests__/cfWorkerTranscript.test.ts src/services/__tests__/healthCheck.test.ts src/services/__tests__/transcriptOutcomeMeasurement.test.ts` -> **3 files / 47 tests passed**.
- TypeScript: `npx tsc -b --pretty false` -> **passed**.
- Targeted lint: `npx eslint src/services/__tests__/cfWorkerTranscript.test.ts src/services/__tests__/healthCheck.test.ts src/services/transcriptOutcomeMeasurement.ts src/services/__tests__/transcriptOutcomeMeasurement.test.ts` -> **passed with 0 errors**.
- Syntax: `node --check cf-worker/src/index.js` and `node --check scripts/health-check.mjs` -> **passed**.
- Diff hygiene: `git diff --check` -> **passed**; only existing Windows LF/CRLF and Git ignore-permission warnings were reported by the surrounding Git checks.
- VPS Python focused tests: **not run** because both `python --version` and `py --version` reported that no interpreter is installed. No interpreter/package was installed to work around this. The added tests are source-visible but have no executed Python result in this cycle.
- Not run by design: `npm test` full suite, production build, E2E/browser verification, live health checks, live Worker/Vercel/VPS/provider traffic, SSH, deployment, and cloud/production checks. The changed application TypeScript is an unreferenced pure helper, so focused tests plus typecheck/lint were proportionate; no browser/R&D evidence was generated.

### State boundary and next gate

- Local: dirty/untracked research set remains intentionally preserved, with the exact grouping above. The VPS source fix is locally confirmed; the Worker CORS/cache marker and pure measurement foundation are locally tested.
- GitHub: `origin/main` remains at `6616139a0810f45b09c5c232054fa6860c9c4aa3`; no commit or push occurred.
- Production: current production revision/config remains unmodified by this task. The accepted Worker-only production evidence remains separate from this local candidate; per-request cold cache denominator remains unknown. VPS deployment state is not established by this cycle.
- Browser/ScrapingBee: paused/archive candidates, no production call-site integration, no provider spend, and no new VPS/provider action. The temporary DigitalOcean validation VPS lifecycle is complete/destroyed as already established; the newer generic-runtime host was not contacted or changed by this cycle.

Cycle 2 behavior-validation gate: use fresh confirmed-caption URLs, prove explicit `MISS` then `HIT` on the same controlled caption request, verify Guest -> Study, exercise a typed failure followed by Retry, run a negative control, and keep ASR/media/audio out of scope. Do not promote local or fixed-control evidence to production cold-cache proof until those observations are captured with the bounded aggregate contract.

## 2026-09-04 ECHO-20260904-2115 - Cycle 2 behavior validation

### Re-anchor and protected worktree

- Re-verified `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, ahead/behind `0/0`, and no staged changes. The exact Cycle 1 grouping remains the source of truth for the existing dirty/untracked research set. Cycle 2 touched only the Worker boundary test plus the local behavior harness/config and bounded Study error classifier/regression test; the current non-ignored set is 45 entries (40 carried forward plus 5 Cycle 2 additions). No unrelated files were moved, removed, reset, cleaned, stashed, or discarded.
- Current dirty groups remain: production-sensitive Worker (`cf-worker/src/index.js` plus the Worker test), production/security-sensitive VPS (`vps-ytdlp/main.py`, `vps-ytdlp/test_main.py`), operational/health-check (`scripts/health-check.mjs` and its focused test), browser experiment (the `scripts/local-native-youtube/` and browser fallback artifacts), ScrapingBee experiment (the `cf-worker/src/scrapingbee*`, `scripts/eval-scrapingbee-*`, and related tests), documentation/journal (`PROGRESS.md`, `TEST_REPORT.md`, `DECISIONS.md`, `.workbuddy/memory/2026-09-04.md`), and Cycle 2 local validation (`playwright.config.ts`, `e2e/cycle2-behavior-validation.spec.ts`, `src/pages/StudyPage.tsx`, `src/pages/studyCaptionError.ts`, and its test). No other/unrelated group was identified.

### Fresh-caption control status

- Three fresh candidate/control identities were checked with low-risk PowerShell YouTube page reads. All three returned `WebException`; no reliable independent caption-track evidence was obtained.
- Result: **fresh confirmed-caption control NOT VERIFIED**. The identities remain candidates only and are not called fresh confirmed-caption controls anywhere in this evidence. Synthetic transcript content in the local browser harness is not YouTube caption evidence.

### Actual local Worker cache boundary

- `src/services/__tests__/cfWorkerTranscript.test.ts` now exercises the actual Worker module through two `worker.fetch` calls for the same request, backed by an in-memory Cache API. The first response is `X-EchoLearn-Transcript-Cache: MISS`; the second is `HIT`; the provider stub is called only for acquisition; both response bodies are usable; and the cache state header is CORS-exposed.
- This deterministic test is the only Cycle 2 `MISS -> HIT` Worker proof. It is local candidate/test-environment evidence with a synthetic provider response, not live Worker, GitHub, or production traffic. The cache namespace/version remains `v=1`.
- The Playwright harness uses `route.fulfill` response headers named `MISS`/`HIT` to exercise browser rendering and header observation. Those are **simulated browser response markers only** and are not Worker cache proof.

### Behavior harness and bounded fix

- Added `e2e/cycle2-behavior-validation.spec.ts` for a clean Guest -> Study journey, non-empty transcript and Study controls, a typed provider failure followed by exactly one Retry request, and a typed `captions_not_found` negative control with no Generate/ASR path. All non-local traffic is aborted; the harness does not contact YouTube, the Worker, Vercel, a provider, a proxy, or a VPS.
- The first real local browser run using system Chrome passed 2/3 cases: Guest -> Study with simulated `MISS` then `HIT`, and typed provider failure -> Retry. The no-caption case failed because the existing page classifier only recognised a legacy message string. That failure led to the bounded fix in `src/pages/studyCaptionError.ts`, used by `StudyPage.tsx`, with regression tests proving typed no-caption recognition and that typed provider failure/timeout messages are not relabelled.
- After the fix, one bounded Node `child_process` runner was attempted. It was unable to complete the browser rerun in this execution environment; no residual local Vite listener remained. Per the supervisor redirect, no further process-launch investigation was done. Therefore the post-fix browser result is **environment-blocked/partial**, not a pass.
- The existing `useCaptionRequest` deterministic suite still proves stale success/failure responses cannot overwrite the latest request, and the Cycle 2 Retry case asserts one request per retry and no `allowAsr` query. No ASR/media/audio was executed.

### Negative control and health-check boundary

- The negative-control harness response is explicitly typed `captions_not_found`, not a timeout or provider failure. It asserts the no-subtitles state, no transcript lines, no Generate transcript action, no ASR opt-in, and a visible Retry action. The post-fix browser assertion is not rerun due the environment block; the pure classifier regression passes.
- No additional health-check traffic ran. The Cycle 1 health-check classifier remains the required boundary: fixed/cached URL success is availability evidence, and absent/invalid cache headers remain `UNKNOWN` rather than fresh acquisition.

### Privacy, validation, and state

- No new telemetry sink or production analytics wiring was added. The only measurement contract remains D-011: outcome code, cache state, latency bucket, Guest/auth state, and Retry-used. URL, video ID, transcript text, user-entered content, upstream bodies, cookies/tokens, and raw provider payloads are excluded from new aggregate events.
- Focused Vitest command covering the Worker boundary, caption request race/retry plumbing, YouTube error classification, ASR recovery contract, measurement contract, and Study classifier: **6 files / 80 tests passed**.
- TypeScript: `node node_modules/typescript/bin/tsc -b --pretty false` -> **passed**.
- Targeted ESLint for the changed Study files, Cycle 2 E2E, and Playwright config -> **0 errors, 7 pre-existing StudyPage warnings** (hook dependency/unused-disable warnings; no new error).
- Production build: `npm run build` -> **passed**; Vite emitted only the existing large-chunk warning and plugin timing notice.
- `git diff --check` -> **passed**; Git emitted existing Windows line-ending and ignore-permission warnings only.
- Python VPS tests were not rerun in Cycle 2 because no VPS source was changed in this cycle; Cycle 1 recorded that Python is unavailable locally. No live health check, Worker, provider, YouTube, SSH, VPS, production, GitHub, commit, push, or deploy validation ran.
- Local state is dirty and preserved. GitHub remains at `origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`. Production revision/configuration remains unmodified; production cache denominator and deployed VPS state are not established by this cycle. Browser-native and ScrapingBee artifacts remain paused/archive-only.

### Cycle 2 result

**PARTIAL.** The local Worker cache boundary, privacy-safe measurement boundaries, typed error classifier, deterministic stale/retry protections, typecheck, lint, build, and diff checks are verified. Fresh confirmed-caption identity and post-fix browser behavior are not verified; no local or simulated result is promoted to production evidence.

Next behavior gate: fresh independently confirmed native-caption control, then a runnable local browser proof of Guest -> Study/non-empty caption data, real Worker boundary `MISS` then `HIT`, typed failure -> Retry, semantic no-caption negative, and no ASR. Keep the browser `route.fulfill` markers explicitly separate from the Worker `worker.fetch`/in-memory Cache API proof.

## 2026-09-04 ECHO-20260904-2200 - Cycle 2 remaining-gate closure attempt

### Re-anchor and preservation

- Re-verified `main`, `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`, ahead/behind `0/0`, no staged changes, and the existing 45-entry non-ignored dirty/untracked set. Cycle 1/2 files remain in their original locations. No destructive Git operation, commit, push, deploy, provider spend, VPS/SSH action, or production mutation occurred.

### Gate A - independent caption evidence

- Local YouTube-origin evidence was attempted with a fresh anonymous system Chrome context, direct watch-page navigation, media/googlevideo blocking, and a sanitized check for YouTube player caption-track metadata/CC surface. Three candidates all failed navigation with `net::ERR_NETWORK_ACCESS_DENIED`. The earlier PowerShell page reads for the same bounded set were `WebException`. These are environment/network blockers, not `captions_not_found` results.
- A direct official-page web read returned only a minimal page shell for one candidate and fetch/cache errors for the other two; it exposed no caption-track metadata. No candidate was promoted based on this path.
- Independent public corroboration supplied by the supervisor for `aircAruvnKk` reports: English language, non-generated/native flag (`isAutoGenerated=false` and separately `isGenerated=false`), non-zero transcript segment/cue count, and a crawl timestamp of `2026-08-16`. A third public tool page independently describes the same input as having an existing caption track. Only these aggregate structural fields were retained; no transcript text, raw response, URL payload, cookie, token, or provider body was stored.
- Result: **Gate A corroborated under the acceptance's independent non-EchoLearn-source wording**, with the explicit limitation that it is **not YouTube-origin UI proof**. If the reviewer requires YouTube-origin confirmation specifically, that narrower sub-gate remains **NOT VERIFIED** because local navigation is blocked.

### Gate B - post-fix browser behavior

- The existing `e2e/cycle2-behavior-validation.spec.ts` was run once through Playwright's own local `webServer` management with the system Chrome fallback. It produced no local `5173` listener and no usable suite result; the hung runner was terminated. A read-only process command-line query was permission-denied, so no unidentifiable `node.exe` was killed; a separate listener check found `NO_LISTENER_5173`.
- Result: **environment-blocked/partial, not behavior-failed**. The earlier real-browser 2/3 result remains pre-fix evidence only: Guest -> Study and typed failure -> Retry passed with simulated responses, while typed no-caption exposed the classifier bug. The bounded classifier fix has deterministic regression coverage, but no post-fix browser pass is claimed.
- The browser harness's `route.fulfill` `MISS`/`HIT` values remain simulated browser response markers. The actual local Worker `worker.fetch` + in-memory Cache API test from the prior cycle remains the only Worker cache proof and independently proves same-request `MISS` then `HIT` at the response boundary.

### Deterministic validation and layer boundaries

- Reran focused Vitest for `studyCaptionError`, `useCaptionRequest`, and `youtubeTranscript`: **3 files / 39 tests passed**, including typed no-caption classification, typed failure/retry plumbing, latest-request-wins stale protection, and no implicit ASR request behavior.
- Prior Cycle 2 full deterministic result remains **40 files / 533 tests passed**. TypeScript, production build, targeted ESLint, and `git diff --check` remain passed from the completed post-fix Cycle 2 validation; this task changed no product code.
- Local: deterministic helper/service evidence is verified; browser behavior is not post-fix verified. GitHub: `origin/main` remains unchanged at `6616139a0810f45b09c5c232054fa6860c9c4aa3`. Production: revision/configuration remains unmodified and production cache denominator remains unknown.
- Browser-native and ScrapingBee remain paused/archive-only. No ASR/media/audio, EchoLearn Worker/provider/Vercel traffic, health-check traffic, proxy, VPS, SSH, credentials, spend, or production request was used in this task.

### Final Cycle 2 status

**PARTIAL.** Gate A has bounded independent third-party corroboration for one fresh candidate but not local YouTube-origin UI confirmation. Gate B is environment-blocked after one Playwright-managed attempt; deterministic post-fix guarantees pass, but no post-fix browser E2E pass is claimed.

Remaining behavior gate: when local YouTube navigation and managed Vite execution are available, verify YouTube-origin native caption evidence and rerun Guest -> Study/non-empty captions, actual Worker `MISS` -> `HIT`, typed failure -> Retry without stale/duplicate corruption, semantic `captions_not_found`, and no ASR/media/audio. Keep all simulated browser markers separate from Worker boundary evidence.

## 2026-09-04 ECHO-20260904-2215 - Native approval continuation and Cycle 2 closure

- Native per-request approval was offered and approved for direct YouTube browser traffic and local Playwright/Vite process execution. The YouTube diagnostic used a fresh anonymous system-Chrome profile, direct `youtube.com/watch` navigation, Playwright CDP observation, and sanitized metrics only. M7 `M7lc1UVf-VE` reached `playabilityStatus=OK`, exposed two English tracks (`manual`, `auto`), and produced one direct YouTube `/api/timedtext` HTTP 200 JSON response with 65,976 bytes and 466 parsed events/segments. Browser metadata reported `navigator.webdriver=false`. No audio/media playback, ASR, caption text, cookies, request headers, tokens, or query values were retained.
- Native-approved Playwright-managed `webServer` execution ran cases 1 and 2 successfully, then case 3 failed before app load with `net::ERR_CONNECTION_REFUSED` because the Vite listener disappeared. This is an environment/process-lifecycle failure and not a semantic test failure; no unknown process was killed.
- Authorized bounded fallback: started attributable Vite PID `12328`, verified the localhost `5173` listener, ran `npx playwright test e2e/cycle2-behavior-validation.spec.ts --project=desktop-chromium`, and stopped only the attributable process. Result: **3/3 passed in 7.7s**. Coverage: Guest -> Study/non-empty captions; simulated browser response markers `MISS` then `HIT`; typed provider failure clears loading and Retry performs exactly one same-request retry; semantic `captions_not_found` negative; no Generate/ASR and no `allowAsr` query.
- Evidence boundaries: Playwright `route.fulfill` cache headers are simulated browser markers, not Worker proof. Actual Worker `worker.fetch` + in-memory Cache API `MISS` then `HIT` remains separately recorded deterministic local evidence. Neither result proves production Worker/provider availability or a YouTube-wide success rate.
- No ASR/audio/media acquisition, live Worker/provider/Vercel/production traffic, proxy, VPS/SSH, provider spend, commit, push, deploy, or production mutation occurred. Managed-webServer lifecycle remains a known local issue; the bounded fallback is the validated execution path for this cycle.

## 2026-09-04 ECHO-20260904-2235 - Fresh native controls and bounded production observation

### Re-anchor and scope

- This cycle remained local-first and no-VPS: no VPS creation/use, SSH, proxy service use, ScrapingBee/managed provider, spend, browser-native production integration, ASR/audio/media acquisition, commit, push, deploy, or production mutation. The previously destroyed temporary VPS remains destroyed; no new VPS was created.
- Branch `main`; `HEAD=origin/main=6616139a0810f45b09c5c232054fa6860c9c4aa3`; ahead/behind `0/0`; no staged changes; dirty/untracked work preserved. The historical 24-video matrix was not rerun.

### Five fresh direct YouTube controls

The existing headed system-Chrome/CDP harness ran one fresh logged-out profile per ID, with media/videoplayback blocked and no ASR/audio. These IDs were outside the historical `FIXTURES` list and were confirmed via YouTube player/timedtext evidence:

| ID | Player/title-author | Track evidence | Timedtext/structural evidence | Outcome |
|---|---|---|---|---|
| `arj7oStGLkU` | `OK`; TED; `Inside the Mind of a Master Procrastinator` | 50 tracks; English manual+auto | `200` JSON; 43,156 bytes; 315 events/segments; 315 lines; 17,471 ms | `SUCCESS` |
| `Ks-_Mh1QhMc` | `OK`; TED; `Your Body Language May Shape Who You Are` | 53 tracks; English manual+auto | `200` JSON; 61,689 bytes; 428/428; 428 lines; 14,617 ms | `SUCCESS` |
| `e-ORhEE9VVg` | `OK`; Taylor Swift; `Blank Space` | 1 track; English manual | `200` JSON; 19,613 bytes; 99/99; 98 lines; 15,409 ms | `SUCCESS` |
| `YQHsXMglC9A` | `OK`; Adele; `Hello` | 2 tracks; English auto+manual | `200` JSON; 16,546 bytes; 74/74; 74 lines; 16,126 ms | `SUCCESS` |
| `OPf0YbXqDm0` | `OK`; MarkRonsonVEVO; `Uptown Funk` | 1 track; English manual | `200` JSON; 26,808 bytes; 140/140; 110 lines; 16,879 ms | `SUCCESS` |

All five reported `navigator.webdriver=false`, zero media bytes, zero page errors, zero initial cookies, valid resource samples, and successful disposable-profile removal. Sanitized manifest: `D:\CODE\API\echolearn\evidence\ECHO-20260904-2235-native\fresh-matrix.json`; SHA-256 `5D3E99B18BC3E41DE00D59DDB39DDE94E541F847DA90380FE3B509B77458F2D3`. No transcript text, raw URLs/query values, cookies, headers, tokens, or raw bodies were retained.

### Production-path result and endpoint boundary

- The same five were exercised through `https://echo-learn.uk/study` in fresh guest profiles using URL paste -> Load -> Transcript/Study wait, with media blocked and browser blocks for `proxy.echo-learn.uk`, `proxy-cheap.echo-learn.uk`, and `yt-api.echo-learn.uk`. The exact result is **Worker/main acquisition 5/5 typed `provider_timeout`** with Worker `/api/transcript` HTTP `504`, plus same-origin `/api/transcript` HTTP `504` for all five; no non-empty body or UI lines rendered, cache header absent so `UNKNOWN`, Retry visible but unused.
- This must not be called an unrestricted full-production user-path result: the harness intentionally prevented those three endpoints, and a blocked fallback could have changed the outcome. Source inspection shows `proxy.echo-learn.uk` is only an opt-in local-proxy branch via `echolearn_local_proxy_url`; fresh profiles cleared it. `proxy-cheap.echo-learn.uk` has no current source reference. `yt-api.echo-learn.uk` is a server-side Vercel `/api/transcript` fallback when `YTDLP_API_KEY` is configured, not a browser endpoint; browser blocking cannot establish whether that downstream call occurred. The deployed build-time `VITE_YOUTUBE_PROXY` value and server-side downstream branch are not fully observable from this run.
- The first same-five pass had three untyped UI failures and two typed timeouts. An instrumentation-only rerun of the same five exposed Worker and same-origin `504/provider_timeout` for all five. Thus report only the precise Worker/main and same-origin observations; later production fallback behavior is **UNKNOWN**, not `captions_not_found`.
- No reliable no-caption negative was established or fabricated. Existing deterministic local Worker `MISS -> HIT` and local Playwright `3/3` remain separate local/synthetic evidence and are not production proof.

### Validation and recommendation

- `node --check scripts/local-native-youtube/run-headed-matrix.mjs` passed before the native run.
- `node --check scripts/validate-production-fresh-matrix.mjs` passed on the final instrumentation run. `agent-browser` was unavailable, so the established external system-Chrome + Playwright/CDP fallback was used.
- This is one low-volume bad window, not a broad YouTube reliability claim. The local native result is `5/5`; Worker/main production observation is `5/5 provider_timeout`; same-origin is `5/5 504`; cache is `UNKNOWN`; no negative denominator exists.
- Recommendation remains **NO VPS for now**. The observed timeout rate justifies a focused fallback/provider-timeout investigation, but the Sol gate requires a second distinct no-VPS bad window before reopening fallback R&D. Next work should be deterministic/source-level or another explicitly approved read-only observation; no infrastructure, SSH, proxy/provider purchase, ASR/media, browser-native integration, or deploy.

## ECHO-20260904-2325: second fresh native window and unblocked production-path observation

### Local native confirmation

The second bounded external headed system-Chrome/CDP run used fresh logged-out profiles, YouTube-origin player/timedtext evidence, media blocking, and no ASR/audio. The five accepted IDs were outside both the historical 24-video `FIXTURES` and ECHO-20260904-2235: `ZbZSe6N_BXs` (PharrellWilliamsVEVO, `Happy`, manual English, player `OK`, timedtext `200`, 15,163 bytes, 75 events/segments, 75 lines, 14,763 ms); `JGwWNGJdvx8` (Ed Sheeran, `Shape of You`, manual+auto English tracks, `200`, 12,780 bytes, 92/90 events/lines, 16,199 ms); `RgKAFK5djSk` (Wiz Khalifa Music, `See You Again`, manual+auto English tracks, `200`, 18,122 bytes, 79/75 events/lines, 16,092 ms); `CevxZvSJLk8` (KatyPerryVEVO, `Roar`, manual English, `200`, 4,737 bytes, 31/31, 15,816 ms); and `60ItHLz5WEA` (Alan Walker, `Faded`, auto English, `200`, 18,021 bytes, 84 events/171 parsed segments/41 lines, 16,197 ms). Native denominator: **5/5 SUCCESS**; all player `OK`, `navigator.webdriver=false`, initial cookies `0`, page errors `0`, media encoded bytes `0`, and profile cleanup passed. No candidate replacement was needed. Sanitized evidence is outside the repo at `D:\CODE\API\echolearn\evidence\ECHO-20260904-2325-native\fresh-matrix-2.json`, SHA-256 `1A78AB4958E68E68B0D3DCA6B4CEC80876557DDBDBA413752A7033C168C99964`. No transcript text or sensitive request data was retained.

### Production Guest -> Study result

The improved harness ran the same five through `https://echo-learn.uk/study` using fresh guest profiles, URL paste -> Load -> Study wait, media-only blocking, no ASR, no Retry, and cleared `echolearn_local_proxy_url`. It did **not** block any transcript fallback endpoint. Results:

| ID | Worker/main and fallback observation | Final UI | Cache | Latency |
|---|---|---:|---|---:|
| `ZbZSe6N_BXs` | Worker request failed; same-origin `/api/transcript` `504`, typed `provider_timeout` | 0 lines; Retry visible | `UNKNOWN` | 15,064 ms |
| `JGwWNGJdvx8` | Worker request failed; same-origin `/api/transcript` `504`, typed `provider_timeout` | 0 lines; Retry visible | `UNKNOWN` | 14,463 ms |
| `RgKAFK5djSk` | Worker `409`, typed `asr_required` | 0 lines; Retry visible | `UNKNOWN` | 3,003 ms |
| `CevxZvSJLk8` | Worker `409`, typed `asr_required` | 0 lines; Retry visible | `UNKNOWN` | 2,386 ms |
| `60ItHLz5WEA` | Worker `409`, typed `asr_required` | 0 lines; Retry visible | `UNKNOWN` | 2,291 ms |

No Retry was used, no endpoint returned a non-empty transcript body, and page errors were `0/5`. The harness initially labeled the first two final outcomes `untyped_failure` because it only consulted Worker response records; their captured same-origin endpoint records were typed `provider_timeout`. The harness now derives typed outcome from all observed transcript endpoints. It was not rerun after this instrumentation-only correction to avoid replaying the same production cases.

### Endpoint and classification boundary

- ECHO-20260904-2235 remains a constrained first-window result: instrumentation rerun observed Worker/main `5/5` typed `provider_timeout` with Worker `/api/transcript` `504` and same-origin `/api/transcript` `504`; its harness intentionally blocked `proxy.echo-learn.uk`, `proxy-cheap.echo-learn.uk`, and `yt-api.echo-learn.uk`, so later fallback behavior was **UNKNOWN**, not unrestricted production proof.
- In current source, `proxy.echo-learn.uk` is only the opt-in `echolearn_local_proxy_url` branch and was cleared in fresh profiles; `proxy-cheap.echo-learn.uk` has no current source reference; `yt-api.echo-learn.uk` is a server-side Vercel `/api/transcript` fallback controlled by `YTDLP_API_KEY`, not a browser endpoint. The live build-time `VITE_YOUTUBE_PROXY` and server environment are not fully observable. The second harness left all of these routes unblocked and recorded `explicitLocalProxyEndpointsBlocked=false`.
- The three `asr_required` results are not `captions_not_found` and not technical bad-window counts. Native YouTube evidence confirms usable captions exist, so this is a provider-acquisition/classification discrepancy: the Worker can report ASR-required after its caption providers yield no usable result, while the client correctly stops before explicit ASR. It is not evidence that the native controls lack captions.
- No reliable no-caption negative was established. Existing deterministic local Worker MISS -> HIT and local Playwright 3/3 remain separate evidence, not production proof.

### Gate verdict and validation

The Sol gate is **MET narrowly for bounded local source/root-cause review**: the first distinct window was 5/5 technical timeout; the second distinct fresh-positive window contains 2/5 technical timeout/network-to-same-origin failures. The remaining 3/5 are typed semantic/authorization outcomes, so this is not a claim of 5/5 technical failure or broad YouTube reliability. No VPS or fallback integration follows automatically. `VPS_NEEDED_NOW=false`; the previously destroyed temporary VPS remains destroyed and no new VPS was created.

Validation run: `node --check scripts/local-native-youtube/run-headed-matrix.mjs` passed; `node --check scripts/validate-production-fresh-matrix.mjs` passed before and after the harness correction; focused Vitest passed **4 files / 79 tests**; `git diff --check` passed with only existing CRLF and inaccessible global-ignore warnings. No product implementation was changed, and no commit, push, deploy, provider spend, SSH, proxy, ASR, media acquisition, or production mutation occurred.

## ECHO-20260905-0012 - Local fallback-order root-cause and regression cycle

### Confirmed source causes

- `src/services/youtubeTranscript.ts` had an overly terminal client decision: typed Worker `asr_required` stopped the server branch before same-origin and client-side independent non-ASR caption routes; a typed server-boundary `provider_timeout`/`asr_required` could likewise prevent InnerTube/page/npm continuation. This conflated “this route exhausted its caption options and ASR is configured” with “all non-ASR caption acquisition routes available to the user are exhausted.”
- `cf-worker/src/index.js` correctly keeps explicit ASR behind `allowAsr=1`, and its `409 asr_required` follows exhaustion of its own bounded caption stages when ASR capability is available. It is not a truthful `captions_not_found` result and is not proof that every frontend fallback was attempted. `api/transcript.ts` uses a 1,000 ms optional yt-api attempt and a 6,500 ms transcript-provider timeout; no broad timeout increase was made.

### Implementation and focused coverage

Changed `src/services/youtubeTranscript.ts` and `src/services/__tests__/youtubeTranscript.test.ts`. The client now defers Worker `asr_required` and server-boundary `provider_timeout`/`asr_required`, runs independent non-ASR routes, and surfaces the typed deferred result only when those routes are exhausted. Explicit ASR still requires consent; no ASR starts automatically. Existing typed errors, cancellation/stale safety, deduplication, Retry, and truthful `captions_not_found` behavior were preserved.

Focused Vitest passed **7 files / 134 tests**, covering Worker `asr_required` followed by independent caption success, exhausted routes retaining terminal `asr_required` without ASR start, timeout continuation to client caption success, provider failure continuation, semantic `captions_not_found`, API/Worker error handling, stale/duplicate/abort behavior, Retry, and ASR opt-in. `npx tsc -b --pretty false` passed. `npm run build` passed with the existing Vite chunk-size warning. Targeted ESLint passed for the changed service/test. `node --check` passed for the touched validation scripts. `git diff --check` passed with only existing CRLF/inaccessible global-ignore warnings.

The optional local Playwright behavior run was attempted once and was environment-blocked by the known Vite webServer lifecycle issue; it timed out with all three tests failing to start. No task-owned listener/process remained afterward. No live YouTube or production behavior evidence was run, and neither prior evidence window was repeated.

### Evidence boundary and recommendation

This is local source/test evidence, not deployed production proof. The prior first-window result remains Worker/main `5/5` typed `provider_timeout` with same-origin `5/5` 504 under a harness that blocked later endpoint hosts; the prior second window remains the unrestricted-by-harness default-route observation (2 technical timeouts, 3 typed `asr_required`). Do not relabel either as evidence of this un-deployed fix. `VPS_NEEDED_NOW=false`; the prior temporary VPS remains destroyed and no new VPS was created. A future production observation must separately verify Worker/main, same-origin/fallback, final UI, cache state (`UNKNOWN` if not observable), latency, and explicit ASR non-start.

## ECHO-20260905-0012 behavior-validation continuation

### Harness diagnosis and fix

- Vite startup itself was verified: `npm run dev` became ready in about 1.2 seconds and Playwright's webServer probe received HTTP 200. The initial failure was the missing bundled Playwright Chromium executable, not Vite startup. Local installed Chrome was used through the existing `ECHOLEARN_E2E_BROWSER_CHANNEL=chrome` configuration.
- The cycle2 spec then exposed a harness defect: cross-origin mocked CF Worker responses did not include `Access-Control-Allow-Origin`, causing the browser to report `Failed to fetch` instead of preserving typed mocked 200/404/502 responses. Added the minimal CORS header to those mock responses in `e2e/cycle2-behavior-validation.spec.ts`.
- An explicit `127.0.0.1` host/command change was attempted but did not improve completion and was reverted. Cycle2 remained unstable across multiple tests: in one run two tests passed and the third got `ERR_CONNECTION_REFUSED` on `page.goto`; another run hung until the outer timeout while Playwright terminated the Vite WebServer. This is runner/teardown evidence, not a product-flow failure. No unrelated processes were killed.

### Stable local behavior evidence

Extended `e2e/study-failure-recovery.spec.ts` with a deterministic Guest → Study scenario in which the mocked Worker returns typed `asr_required` and the independent same-origin/Vercel route returns usable caption lines. The scenario asserts Worker then Vercel ordering, non-empty rendered transcript, no `allowAsr=1`, and no ASR-generation UI. The existing Worker-timeout → Vercel scenario and the new `asr_required` scenario passed together: **2/2, 5.8 s**. The cycle2 no-caption scenario also passed individually after the CORS correction. This is local mocked behavior evidence only; no live YouTube, production, media, audio, ASR, VPS, proxy, or provider traffic was used.

Final behavior status: **PASS** for local app startup and the changed fallback semantics through the stable harness; **BLOCKED** for the cycle2 multi-test runner's independent teardown/lifecycle completion. The implementation remains un-deployed and production behavior is unknown. `VPS_NEEDED_NOW=false`; no commit, push, deploy, or production mutation occurred.

## ECHO-20260905-1237 intended-diff/code-review gate

### Intended candidate (Category A)

The intended candidate is limited to selected hunks in `src/services/youtubeTranscript.ts`, its focused regression file `src/services/__tests__/youtubeTranscript.test.ts`, and the added Worker `asr_required` -> independent Vercel caption Guest -> Study scenario in `e2e/study-failure-recovery.spec.ts`. The CORS headers in `e2e/cycle2-behavior-validation.spec.ts` are retained as harness correctness support only. Current review/evidence sections in `PROGRESS.md`, `TEST_REPORT.md`, and `.workbuddy/memory/2026-09-05.md` are durable record hunks, not wholesale production changes.

The source diff remains limited to deferring typed Worker/server-boundary `provider_timeout` and Worker `asr_required` until independent non-ASR client routes run. It preserves typed terminal behavior when exhausted, explicit ASR consent, no `allowAsr=1` auto-start, semantic `captions_not_found`/acquisition-blocked distinction, cancellation/stale protection, in-flight deduplication, Retry, and existing error rendering.

### Excluded or follow-up dirty work

Category B is excluded: Worker cache observability and tests (`cf-worker/src/index.js`, `src/services/__tests__/cfWorkerTranscript.test.ts`); VPS/yt-dlp; health-check; all ScrapingBee adapters/evaluators/tests; all local-native YouTube scripts/tests; the production fresh-matrix harness; browser fallback adapter/orchestrator modules/tests; transcript measurement modules/tests; and the optional Playwright Chrome-channel configuration. These remain preserved research/infrastructure changes and are not authorized to ride a future commit/deploy.

Category C requires a separate decision: `src/pages/StudyPage.tsx`, `src/pages/studyCaptionError.ts`, and its test are an earlier related typed no-caption UI correction, not required for this fallback-order candidate. `DECISIONS.md` was not changed in this review; D-012 remains canonical and D-009/D-010 remain superseded.

### Review findings and validation

No P0/P1 issue was found in Category A. A pre-existing risk remains: client fallback routes lack one aggregate deadline, so sequential independent attempts can increase latency after a timeout/asr-required response. It is recorded as a separate timeout-design follow-up; no speculative global timeout change was made.

Stable local browser validation passed the existing timeout fallback and new ASR-required fallback together (**2/2, 5.8 s**). The new test proved Guest -> Study, Worker -> independent Vercel ordering, non-empty rendered lines, zero `allowAsr=1`, and no ASR-generation UI. The cycle2 no-caption case passed individually after the CORS correction; its multi-test runner remains a test-infrastructure blocker. Targeted E2E ESLint and `git diff --check` passed. No prior broad suite, live YouTube, production matrix, VPS, proxy, paid provider, ASR, audio, or media test was rerun.

Review verdict: **Category A ready for explicit commit/deploy authorization, not production accepted**. `VPS_NEEDED_NOW=false`; no commit, push, deploy, or production mutation occurred.

## ECHO-20260905-1357 - Exact production deployment and bounded observation

### Deployment verification

The pushed commit `a8d144cdd1fbdab2ebd32ecb6495858a7dcc49e8` was already deployed by the Vercel GitHub App: GitHub deployment `6275908365` is `Production`, SHA-exact, and `success`, with target `https://echolearn-jhjdwuan4-shmily0826s-projects.vercel.app`. Canonical production `https://echo-learn.uk` returned Vercel HTTP 200 and referenced `/assets/index-DqSgfbdf.js`. No Vercel CLI was installed/authenticated locally, so no duplicate manual deployment was attempted.

### Bounded live behavior

Exactly two previously independently confirmed native-caption controls were observed through fresh production Guest -> Study profiles. Media was blocked; transcript fallbacks were not browser-blocked; local proxy storage was cleared; Generate transcript and Retry were not used.

| Control | Worker/main | Same-origin/client | UI / cache / latency |
|---|---|---|---|
| `ZbZSe6N_BXs` / `Happy` | HTTP 504, typed `provider_timeout` | `/api/transcript` HTTP 504, typed `provider_timeout`; `/api/yt` HTTP 200 but no non-empty lines | 0 lines, Retry visible; cache `UNKNOWN`; 24,579 ms |
| `JGwWNGJdvx8` / `Shape of You` | HTTP 504, typed `provider_timeout` | `/api/transcript` HTTP 504, typed `provider_timeout`; `/api/yt` HTTP 200 but no non-empty lines | 0 lines, Retry visible; cache `UNKNOWN`; 21,790 ms |

Both cases recorded zero browser request query values `allowAsr=1`, zero page errors, no Retry use, and no ASR/audio/media acquisition. API 200 is not treated as success because no transcript lines reached Study. This is post-deploy evidence at `n=2`, not a broad reliability claim and not a rerun of either historical five-control window.

### `/api/yt` root-cause diagnostic

One corrected, single-control Happy observation classified the three same-origin `/api/yt` 200 responses without retaining bodies, raw URLs, headers, cookies, tokens, or transcript text. Two were `POST` InnerTube player JSON responses (4,824 and 3,210 bytes, `LOGIN_REQUIRED`, zero `captionTracks` and zero timed-text events). One was a `GET` YouTube page HTML response (1,210,847 bytes, `ytInitialPlayerResponse` marker present, no `captionTracks` marker). No timedtext call ran because no usable caption track URL was returned. This is consistent with committed `youtubeTranscript.ts`: the player/page stages reject no usable track list and never reach timedtext parsing; no extraction loss was proven.

### Verdict and boundary

Production acceptance is **NOT MET** for this bounded observation (`0/2` final UI successes). The client candidate is deployed exactly and local fallback-order regressions remain separate evidence; the observed Worker and same-origin timeouts plus Login-required/trackless `/api/yt` responses leave the upstream/provider-chain cause unresolved. The diagnostic also ended with 0 UI lines, Retry visible, `allowAsr=1` count 0, and no ASR/audio/media acquisition. No VPS, SSH, proxy, paid provider, source mutation, commit, push, or manual deploy action occurred in this validation cycle; the prior temporary VPS remains destroyed. `VPS_NEEDED_NOW=false`.

### Provider/upstream A/B review

Production `youtubeTranscript.ts` sends same-origin `/api/yt` InnerTube POSTs with Android `20.10.38` and WEB `2.20241201.00.00` client identities, `hl=en`, `videoId`, `contentCheckOk=true`, and `racyCheckOk=true`. `api/yt.ts` translates these to server Android or Chrome/125 User-Agent/client headers, adds a fixed consent cookie and language header, and does not forward browser Origin/Referer, visitorData, playbackContext, browser session cookies, or PO-token/attestation material. Page GETs use the same server-side Chrome/125 identity.

The known-good local control used real logged-out system Chrome directly against YouTube origin, with browser-generated session/context and first-party requests; it independently exposed native `captionTracks` and timedtext HTTP 200 cues. The production Happy diagnostic instead saw two HTTP 200 InnerTube player JSON responses with `LOGIN_REQUIRED`, zero caption tracks/events, then one HTTP 200 page HTML response with `ytInitialPlayerResponse` but no `captionTracks`. No timedtext call occurred. The evidence therefore places failure before subtitle URL exposure and does not show cue-parser loss.

Current upstream context: the [yt-dlp PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) describes session/video-bound PO tokens and current `web` Subs enforcement; [#15865](https://github.com/yt-dlp/yt-dlp/issues/15865) records browser-playable videos with non-browser `LOGIN_REQUIRED`; [#17375](https://github.com/yt-dlp/yt-dlp/issues/17375) reports datacenter/public-VPN IP reputation effects and intermittent `LOGIN_REQUIRED`/403; [#17125](https://github.com/yt-dlp/yt-dlp/issues/17125) is a distinct after-track-exposure missing-Subs-PO-token case. These sources support a combined server-context/egress hypothesis, but PO-token enforcement is not proven as the direct cause because no subtitle request was reached. No speculative non-ASR request change was made.

## ECHO-20260905-1424 - Local Node static-recipe discriminator

One direct YouTube-origin Node experiment from local desktop egress replayed the current `/api/yt` static recipe for Happy only. It used Android `20.10.38` and WEB `2.20241201.00.00`, the same body fields (`hl`, `videoId`, `contentCheckOk`, `racyCheckOk`), server-style User-Agent/client headers, fixed consent/language behavior, and no Origin/Referer, visitorData, playbackContext, PO token, or imported cookies.

| Variant | HTTP / structure | Caption evidence |
|---|---|---|
| Android player | `200`, JSON, `playabilityStatus=OK` | 1 caption track; timedtext URL exposed |
| WEB player | `200`, JSON, `playabilityStatus=UNPLAYABLE` | 0 caption tracks |
| YouTube page | `200`, HTML | `ytInitialPlayerResponse` and `captionTracks` markers present |

Only structural metadata was emitted; raw bodies, URLs, cookies, tokens, and transcript text were not retained. Compared with Vercel's Android/WEB `LOGIN_REQUIRED` and trackless page, Android success from the same static recipe raises confidence that Vercel/server egress or IP reputation is a dominant variable. Local WEB failure keeps browser/session/attestation or client-specific enforcement as a contributing factor. Because no timedtext request ran, PO-token enforcement is not proven as the direct cause; the local Android track exposure without a supplied PO token argues against treating it as the immediate failure stage. No source mutation or minimal fix is justified.

## ECHO-20260905-1440 - Existing Cloudflare `/api/yt` discriminator

`handleProxy` was inspected before execution and confirmed as a pure allowed-host YouTube forwarder. The existing Worker route accepts the supplied POST body, applies Android UA/JSON/language/consent headers, forwards the request, and returns the upstream response; it does not enter `/api/transcript`, VPS, ASR, ScrapingBee, or media acquisition.

Exactly one Happy Android InnerTube POST was sent through the deployed Cloudflare Worker `/api/yt` route. The Worker returned HTTP `200`; sanitized upstream structure was JSON, `4,800` bytes, `playabilityStatus=LOGIN_REQUIRED`, zero caption tracks, no timedtext URL, and zero timedtext events. No raw body, target URL/query, cookie, token, or transcript text was retained.

This is negative for Cloudflare as an immediate replacement: local Node direct Android previously returned `200/OK/1 track`, Vercel returned `LOGIN_REQUIRED/0 tracks`, and Cloudflare also returned `LOGIN_REQUIRED/0 tracks`. The changed variable is therefore broader cloud/server egress or environment versus desktop/browser context; exact IP reputation and attestation contributions remain unresolved. No source/config fix is justified and `VPS_NEEDED_NOW=false` remains unchanged.

## ECHO-20260905-1435 - No-VPS solution-design investigation

### Current path map

The frontend first uses an explicitly configured local proxy only when `echolearn_local_proxy_url` exists. Its default server path calls the Cloudflare Worker `/api/transcript`, then same-origin Vercel `/api/transcript`; after typed server failures are deferred, it tries InnerTube Android/WEB and page scraping through Vercel `/api/yt`, then the client `youtube-transcript` package/CORS GET fallbacks. `VITE_YOUTUBE_PROXY` could replace the default `/api/yt` target, but the production build value is unknown.

Vercel `/api/yt` is a server-side YouTube forwarder. It applies server Android/Chrome-125 identities, client headers, fixed consent cookie, and language header, without browser visitor/session context or PO-token attestation. Vercel `/api/transcript` is separate: it attempts the historical `YTDLP_API_URL` VPS route, then the server npm transcript provider. The Worker `/api/transcript` is Cloudflare egress and directly runs Android/iOS/WEB/TV InnerTube, webpage, Invidious, and Piped caption stages; the Worker also exposes a Cloudflare `/api/yt` forwarder. The VPS/provider branch remains historical server infrastructure, not a new action.

### Design boundary and candidates

Local static Android success for Happy and Shape rules out an inherently invalid request body/client recipe, but not server egress or environment. Production `LOGIN_REQUIRED`/trackless responses occur before timedtext exposure; the deployed fallback-order fix therefore remains necessary but not sufficient. The Worker path is architecturally a materially different egress, but current Worker `provider_timeout`/`asr_required` results do not prove that it exposes native tracks, and Cloudflare is not assumed residential/clean.

1. **Existing Worker stage discriminator:** highest information gain, low cost, reversible. A future single-control read-only Worker observation, using existing sanitized debug stage outcomes only if already enabled, could distinguish InnerTube/page/timedtext/deadline failure from Cloudflare egress. Enabling new debug/telemetry would require separate authorization.
2. **Clean Vercel preview/region A/B:** moderate information gain and greater operational cost. Replay the same Android request from a clean exact-commit preview or explicitly authorized Vercel network/region variant. This avoids production mutation but does not guarantee a materially different IP reputation; deployment/authentication and rollback boundaries need approval.

Browser-native fallback, managed alternate egress/provider, and VPS/residential paths remain later, higher-cost options. No solution was implemented or deployed, and `VPS_NEEDED_NOW=false` remains unchanged.

## ECHO-20260905-1555 - Supadata Playground local Playwright blocker

The minimal local browser capability check found Playwright `1.62.1` and the installed Chrome channel. A single fresh browser navigation to `https://supadata.ai/playground` failed before DOM load with `ERR_NETWORK_ACCESS_DENIED`; the script stopped without clicking Run. Therefore there is no Supadata provider result and no native transcript capability evidence. No direct YouTube, alternate provider, proxy, VPS, ASR/audio/media, production, source/config/test, commit, push, or deploy action occurred. This remains an environment blocker rather than a provider verdict; `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1534 - Active-goal scope guard and current Supadata handoff

This documentation-only checkpoint records the new durable scope-discipline policy in `DECISIONS.md`. Once the active goal, root cause, and acceptance criteria are specific, additional work must have a clear current hypothesis, acceptance-criterion, regression, or safety purpose; task-start/recovery history and history required by a concrete hypothesis remain allowed. Unrelated historical reading, speculation, repeated stable tests, and unrelated polishing are scope drift.

Supadata native-only capability is still **untested**. The no-key direct API attempt produced no HTTP response (`fetch failed`) and therefore no provider status or capability evidence; no local Supadata credential exists. The official Playground remains the only untested no-key path, requires Chrome Computer Use approval, and has had no completed Run. No provider spend, VPS, source/config/test mutation, production mutation, commit, push, or deploy occurred; `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1640 - Supadata Playground Native matrix

The user-launched dedicated Chrome at CDP `9222` was attached successfully with Playwright `connectOverCDP`. It was a temporary local test instrument, not a production architecture. The Playground remained API-key blank, `Language=Auto`, `Mode=Native`, and `Text=false`; Generate/ASR was not selected.

| Control | Result | Structured evidence |
|---|---|---|
| Happy (`ZbZSe6N_BXs`) | PASS | User-manual result |
| Shape of You (`JGwWNGJdvx8`) | PASS | 92 non-empty native cues |
| See You Again (`RgKAFK5djSk`) | PASS | 79 non-empty native cues |
| Roar (`CevxZvSJLk8`) | PASS | 31 non-empty native cues |
| Faded (`60ItHLz5WEA`) | PASS | 42 non-empty native cues |

All five had structured native output with timestamps/durations, monotonic offsets, and semantic binding to the requested video (`semanticMatch=true`). The harness lesson is material: unrelated background HTTP 200s are not settlement. A valid sequential run must require exactly one new `/api/run`, a changed Result fingerprint, matching input URL, and semantic binding before the next click; a click with no `/api/run` is a harness failure, not a provider failure or retry.

This is local browser-context capability evidence only. It does not establish Supadata API-key behavior, API integration, production/cloud egress, cost/privacy/rate-limit performance, or EchoLearn production reliability. Supadata is a strong managed-provider integration candidate for formal API/cost/privacy/latency/reliability evaluation, but is not adopted or production-ready. No EchoLearn source/config/test code changed; no commit, push, deploy, VPS/proxy, provider spend, ASR, audio, or media acquisition occurred. `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1705 - Authenticated Supadata API probe blocker

The project-root `.env.local` `SUPADATA_API_KEY` was confirmed non-empty without disclosure. Exactly one official Supadata transcript GET was attempted for Happy (`ZbZSe6N_BXs`) with `mode=native`, `text=false`, and `lang=en`. It returned no HTTP response and failed in the local/Codex network context with a fetch `TypeError` after approximately `136 ms`. No retry or polling occurred, so authenticated API capability remains **UNTESTED**; there are no HTTP, response-structure, cue, timing, or semantic results to report.

This is a local/Codex network-context blocker, not a Supadata provider failure. The next discriminator should use the user's normal desktop network context and must not repeat this blocked Codex path. No source/config/test change, commit, push, deploy, provider spend, VPS/proxy, ASR, audio, or media acquisition occurred; `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1710 - Desktop authenticated Supadata API PASS

A user-run normal-desktop-network authenticated probe for Happy (`ZbZSe6N_BXs`) succeeded: HTTP `200`, latency approximately `3,353 ms`, `lang=en`, `availableLangs=en`, `cueCount=75`, non-empty content, numeric offsets/durations present with monotonic offsets, and `semanticMatch=true`. Transcript text was not retained.

This is separate from ECHO-20260905-1700, where the same authenticated API capability probe from the Codex network context failed locally with `TypeError` before any HTTP response. The new result proves authenticated Supadata API native capability from the user's normal desktop network; the earlier result remains an execution-environment network blocker, not a Supadata provider failure. Next: run exactly one authenticated native-only matrix for Shape of You, See You Again, Roar, and Faded, without retrying Happy, then decide whether integration evaluation should proceed. No source/config/test change, commit, push, deploy, provider spend, VPS/proxy, ASR, audio, or media acquisition occurred; `VPS_NEEDED_NOW=false`.

## ECHO-20260905-1720 - Supadata integration budget blocker

The authenticated native-only matrix is **5/5 acquisition PASS**: Happy 3,353 ms / 75 cues, Shape of You 14,352 ms / 92 cues, See You Again 2,789 ms / 79 cues, Roar 2,288 ms / 31 cues, and Faded 2,110 ms / 42 cues. All were non-empty with monotonic offsets. Strict semantic matching was 4/5 plus one matcher-inconclusive result for See You Again; its structure matched the prior Playground semantic PASS, so it is not a provider failure.

Direct code evidence: `fetchYouTubeServerTranscript` uses an 8,000 ms Vercel timeout for caption-only requests. The Vercel handler's existing VPS and npm budgets are 1,000 ms and 6,500 ms. A post-npm Supadata timeout of 2,500 ms would not admit the known-positive 14,352 ms result and would violate the integration objective. The unsafe draft was removed; no Supadata integration or new tests remain. No tests were run for the reverted draft. The bounded decision is either (A) increase the Vercel caller budget and choose provider order, likely Supadata before npm, or (B) keep the current budget and defer integration. No commit, push, deploy, or production change occurred.

## ECHO-20260905-1735 - Supadata native fallback validation

### Implementation under test

- Provider order on the Vercel fallback path is configured VPS, opt-in Supadata native, then the existing youtube-transcript/npm provider. Absence of `SUPADATA_API_KEY` preserves the old path.
- Supadata uses one server-side request with `mode=native` and `text=false`; an already-known requested language is passed, otherwise language is left to API default behavior. `content[]` cues are validated for non-empty text and finite nonnegative offset/duration, sorted as required, and converted to the existing seconds-based cue model.
- The handler uses a 21 s overall deadline and an 18 s Supadata cap; npm receives only remaining time. The caption-only Vercel caller is 22 s, while the fast Worker path is unchanged. No `vercel.json` duration change was made because deployed runtime compatibility is not provable from the repository.

### Deterministic validation

- `src/api/__tests__/transcriptHandler.test.ts` and `src/services/__tests__/youtubeTranscript.test.ts`: **55/55 PASS**.
- Covered no-key old behavior; order and single-call behavior; native-only query; optional language; valid cue normalization; malformed/empty payload; HTTP 206 continuation; 401/403/429/5xx/network/timeout typing; remaining-budget abort behavior; earlier provider/acquisition failure arbitration; secret absence from output/logs; no `allowAsr`, Generate, or ASR path; and delayed approximately 14.5 s success within the new budget.
- `npx tsc -b --pretty false`: PASS. `npm run build`: PASS. Targeted ESLint for changed source/tests/E2E: PASS. `git diff --check`: PASS.

### Behavior/browser evidence

- The installed-Chrome single delayed Study case passed its product assertions in **14.2 s**: captions arrived after the old 8 s boundary, rendered non-empty, issued no `allowAsr=1` request, and showed no Generate Transcript/ASR state.
- The outer Playwright command timed out during runner/webServer cleanup after the test passed. No further E2E retry was made; E2E completion is recorded as **validation-layer BLOCKED**, while the behavior assertion remains PASS. No live provider request was made.

### Release truth

- Local source/tests/docs contain the implementation and evidence above. GitHub is unchanged because there was no commit or push. Production is unchanged because there was no deploy, dashboard mutation, or secret setup; Vercel runtime-duration and server-side key binding still require deployment-time verification.

## ECHO-20260905-1808 - Deployment-readiness verification

- Repository state: root, branch, HEAD, origin, and dirty-work inventory were confirmed read-only. No unrelated paths were changed.
- Local binding: `.vercel/project.json` links project `echolearn`; `vercel.json` has rewrites only and no duration/runtime override. `.env.local` contains a non-empty `SUPADATA_API_KEY` by boolean check only and remains ignored. The key value was never printed, logged, or written to a tracked artifact.
- Remote binding/runtime: Vercel CLI is unavailable on PATH and `npx --no-install vercel` is unavailable. Therefore Vercel Production/Preview/Development environment-variable presence and deployed function/runtime duration could not be queried. This is an observation limitation, not evidence that the remote key is absent or that runtime capacity is insufficient.
- Privacy review: no production client `VITE_` or `import.meta.env` Supadata reference was found; only server/API test references remain. No server logging pattern exposes the key, transcript text, or request URL. No provider, YouTube, app, dashboard, commit, push, or deploy request was made.
- Release readiness: local code is validated, but production env binding is **unverified** and deployed runtime duration is **unverified**. `vercel.json` was intentionally left unchanged. Commit/push/deploy remain separate actions awaiting explicit authorization.

## ECHO-20260905-1818 - Deployment configuration update

- `vercel.json` was changed only for the transcript function: official `$schema` added and `functions["api/transcript.ts"].maxDuration` set to **30**. Existing rewrite count remained **7**; no other function changed.
- Native PowerShell validation passed for JSON parsing, schema presence, exact transcript function key/duration, and rewrite preservation. `npm run build` passed after the config change. No unrelated tests or E2E runs were repeated.
- The one bounded temporary CLI attempt failed before authentication with npm `EACCES` while fetching `vercel@latest`. Production/Preview/Development env presence could not be queried and `SUPADATA_API_KEY` was not added. The local ignored `.env.local` secret was checked only for boolean presence; its value was never printed or logged.
- No provider, YouTube, app, dashboard, commit, push, or deploy action occurred. Runtime ambiguity is resolved in tracked local config; Production secret binding remains the sole Vercel setup blocker before the separate commit/push/deploy authorization boundary.

## ECHO-20260905-2125 - Current Production secret status

- User-reported dashboard state: Production-only `SUPADATA_API_KEY` was manually added in Vercel Dashboard. This was not independently verified, and no secret value was read, stored, printed, or logged.
- The ECHO-20260905-1818 CLI blocker remains historical and is not rewritten. No redeploy has occurred, so production behavior and runtime secret activation remain unproven and unchanged.
- Local source/config validation remains release-prep green from ECHO-20260905-2120. Commit, push, and deploy still require explicit authorization. Browser-control artifacts `.playwright-cli/` and `.tmp-playwright-daemon/` must not be staged.

## ECHO-20260905-2228 - Production Supadata fallback validation

- Deployment evidence: user confirmed Vercel revision `61fe54d` is **Ready** and **Production** on `main`.
- One and only one production caption-only request was sent to `https://echo-learn.uk/api/transcript` for `ZbZSe6N_BXs`. Sanitized result: HTTP `200`; latency `4512 ms`; `source=supadata`; language `en`; `75` cues; non-empty; timestamps valid and monotonic; no failure code.
- No retry, polling, direct Supadata request, ASR, Generate, auto mode, secret access, or deploy occurred. Transcript text was not printed or retained.
- Acceptance result: the deployed Supadata native-only fallback is conclusively validated server-side. Browser Study-page E2E is optional and non-blocking because it would add UI confidence without materially changing this release decision.

## ECHO-20260905-2245 - Caption Diagnostics V1

### Focused implementation checks

- Provenance is carried as raw optional `source` data and translated only at the Study display boundary. A dedicated source-label regression test verifies `supadata` renders as one label rather than being translated twice.
- Supadata attempt diagnostics survive fallback-success cases, including Supadata unavailable/failure followed by npm/native success. The browser-local aggregate records one observed attempt, classifies success/unavailable/timeout/failure, and estimates one likely credit per attempt without claiming actual billing.
- Optional session provenance fields remain backward compatible with legacy saved sessions. The stale dashboard-navigation comment claiming source was not recorded was removed.
- The Study signal is compact and reactive after an attempted request: provider, elapsed time, cue count, likely Supadata use, and this-browser attempts/likely credits. No secret, URL/video ID, transcript text, upstream payload, cookie, or token is included.

### Validation actually run

- Focused Vitest: **84/84 PASS** across `transcriptHandler`, `youtubeTranscript`, `captionDiagnostics`, `useCaptionRequest`, `studySession`, and `captionSource` tests.
- `npx tsc -b --pretty false`: PASS.
- Targeted ESLint over changed Caption Diagnostics source/tests: PASS with 0 errors; 8 StudyPage hook/dependency warnings remain from the existing callback/effect structure.
- `npm run build`: PASS; only normal bundle-size/plugin timing warnings.
- No provider, YouTube, production, browser, commit, push, or deploy action was performed in this correction cycle.
