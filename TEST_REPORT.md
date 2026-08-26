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
