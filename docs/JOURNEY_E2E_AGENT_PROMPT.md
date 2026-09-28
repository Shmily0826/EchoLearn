# 任务 Prompt：为 EchoLearn 补两条「真实用户旅程」E2E

下面这份文档是自包含的，可以直接整段复制给执行 agent。它假定 agent 从零开始读这个仓库，不需要本轮对话的任何上下文。

---

## 0. 你要做的事（一句话）

在 `D:\CODE\project\EchoLearn` 里新增两个 **journey 级** Playwright spec，覆盖两个目前完全没有覆盖的真实用户场景：**隔天回来复习（多天推进）** 和 **多课共存、切走再切回**。测试要像真实用户那样点，不要从 `data-testid` 抄近路。

## 1. 仓库事实（已核实，直接使用，不要重复发现）

**位置与状态**
- 仓库 `D:\CODE\project\EchoLearn`，分支 `main`，HEAD `ac2715e`，工作区 clean，`main` 与 `origin/main` 0/0。
- 技术栈：React 19 + TypeScript + Vite 8 + Vitest 4 + Playwright 1.62 + Firebase Auth/Firestore。

**常用命令**
```
npm run dev                 # vite dev server, http://localhost:5173
npm test                    # vitest run（当前基线约 981 个用例）
npx tsc -b                  # 类型检查
npm run lint                # 基线：0 error / 12 warning
npm run build
npm run test:emulator       # Firestore 规则测试，需要本机 Java 17
npx playwright test e2e/<file>.spec.ts --project=desktop-chromium   # 单跑一个 spec
```

**Playwright 配置（`playwright.config.ts`）**
- `baseURL = http://localhost:5173`，`workers: 1`，`fullyParallel: false`，单用例 `timeout: 60s`，CI 下 `retries: 1`。
- 三个 project：`desktop-chromium`（默认 1280x720）、`mobile-chromium` / `mobile-webkit`（只跑 `mobile-pwa.spec.ts`）。
- webServer 会自动起 `npm run dev`。
- 如果本机缺少 Playwright 自带 Chromium，用 `ECHOLEARN_E2E_BROWSER_CHANNEL=chrome npx playwright test ...` 走系统 Chrome。

**已有 helpers（`e2e/helpers/`，优先复用，不要重写）**
- `guestMode.ts` → `enterGuestMode(page)`：点 guest 按钮、处理语言选择、等到 app shell 可见且 `.driver-overlay` 数量为 0。
- `sessionFixture.ts` → `openSignedInApp(context, page)` + `SYNTHETIC_IDENTITY` / `SYNTHETIC_IDENTITY_UNVERIFIED`：用**假 Firebase 身份**进入登录态，不发任何真实请求。本任务用不到（走 guest 即可），但如果要测登录态下的同步，用它。
- `mockDictionary.ts`、`analyticsTraffic.ts`：词典与埋点的 mock 工具。

**存储键（`src/utils/storage.ts`）**
```
echolearn_vocabulary / echolearn_sentences      # 词表、句库
echolearn_session                               # 当前课程
echolearn_sessions_list                         # 课程列表
echolearn_lang / echolearn-lang-chosen           # 语言
echolearn-tour-completed-v1                      # 新手引导已完成标记
echolearn_guest_mode
```

**复习调度规则（`src/utils/storage.ts:105` + `src/utils/reviewSchedule.ts`）**
- `computeNextReviewAt(reviewCount)`：`1→3天, 2→7天, 3→14天, 4→30天, 5→90天, 6→180天, 7→365天`；`reviewCount >= 5` 同时置 `mastered: true`。
- "记得"按钮：`reviewCount + 1`，`nextReviewAt = computeNextReviewAt(newCount)`，`lastReviewedAt = now`。
- "忘了"按钮：`reviewCount - 1`（下限 0），`nextReviewAt = 明天`，`mastered = false`。
- `isDue(item) = nextReviewAt > 0 && nextReviewAt <= 今天 0 点 + 24h`（整天都是到期窗口）。
- `nextReviewAt === 0 && !mastered` = **历史遗留未调度项**：不算到期，**且读取时不允许被批量改写**（这是一条被明确记录下来的不变式）。
- `src/utils/reviewSchedule.ts` 是 Dashboard 计数、Review 落地页计数、Review 队列三处共用的唯一"到期"定义。

**UI 发现方式（重要）**
- `DashboardPage.tsx` **没有任何 `data-testid`**；`ReviewPage.tsx` 只有一个 `review-first-day-hint`。
- 所以：**用可见的 role / name / 文本去发现元素**，这也是本仓库既定的写法（历史 bug 之一正是因为测试用 `getByTestId` 抄近路，从来没拿控件和首屏视口比过）。
- i18n key 在 `src/i18n/`，复习页主要用 `review.*`（`dueToday` / `unmastered` / `mastered` / `complete` / `accuracy` / `reviewed` / `toReviewAgain` / `noItems` / `reviewDue` / `allCards`）。

## 2. 阶段 A —— 多天复习旅程（P0，先做这个）

新建 `e2e/review-multi-day-journey.spec.ts`。

**为什么值得做**：SRS 3→7→14→30 天是这个产品的核心卖点，`TEST_REPORT.md` 里已有的复习测试全部是"受控库 + 单点断言"，**没有任何一条把日历往前推过**。真实用户是隔天回来的。

**种子数据怎么造（关键取舍）**
- **至少 2 个词必须通过真实 UI 造出来**（进 Study → 打开内置 Sample → 点词 → 保存），保证测的是应用真实会写出的形状。
- 其余用 `localStorage` 直接 seed 扩充规模（5 个到期词 + 1 个 `mastered` 控制项 + 1 个 `nextReviewAt: 0, mastered: false` 的遗留未调度控制项）。
- **并断言这两类词行为完全一致**（都进队列、`reviewCount` 都推进相同天数）。这一步是防止"seed 了一个应用根本不会产出的形状"，本仓库此前吃过这个亏。

**关于时间旅行（明确要求）**
- **不要**用 `page.clock` 全局改时间：它会和媒体播放时钟、Firebase SDK 的时间判断打架，`local-audio.spec.ts` 和 `skip-controls.spec.ts` 里的 clock 用法只作用于媒体元素。
- 改用等价做法：应用写下的 `nextReviewAt` 全都相对 `Date.now()`，所以"把日历往前推 N 天"与"把每个 item 的 `nextReviewAt` 减去 N 天"在数学上完全等价。用 `page.evaluate` 改写存储值即可，**并在 spec 注释里写清这个等价关系**，否则后来者会以为是作弊。

**旅程步骤（一条 test，或按属性拆成 2-3 条，你判断）**
1. 全新 guest（每个用例一个干净 context），`enterGuestMode`，语言 English。
2. 通过 UI 存 2 个词 → 补齐 seed 到 5 个到期词 + 2 个控制项。
3. **Day 0**：Review 页显示 due 数 = 5；走完一轮（"记得" ×3、"忘了" ×2 混合）；断言每个卡片 `reviewCount` 与 `nextReviewAt` 落到了正确的那档，"忘了"的那个 `nextReviewAt` 是明天且 `mastered` 被清掉。
4. **+3 天**：改写存储 → Dashboard / Review 的 due 数回到 5 → 再走一轮 → 断言进入 7 天档。
5. 重复 **+7 天 → 14 天档**、**+14 天 → 30 天档**，直到第 5 次"记得"后 `mastered: true` 且 `nextReviewAt` 落到 90 天档。
6. **不变式断言**（每条都要能单独失败）：
   - 遗留未调度项（`nextReviewAt: 0`）**永远不进队列**，且走完整个旅程后 `nextReviewAt` 仍是 0、`reviewCount` 未被改动。
   - `mastered` 控制项只在自己的长周期到期后才重新出现，不是每次都出现。
   - **Dashboard 显示的 due 数字 == Review 按钮真正建出来的队列长度**。（这是本仓库真实出过的一类 bug：六处各自算"到期"，显示的数字和按钮建的队列不一致。）
   - 走完后 Vocabulary 页的总数与 mastered 过滤器和上面一致。

**Falsify（硬性，不许跳过）**
每条核心断言，都要临时把对应的 guard 摘掉（或把 seed 值改坏），确认测试**真的变红**，并在 spec 注释 / 报告里记下失败消息原文。只绿不红的断言不算证据。已知可以这么做：
- 把 `isUnscheduled` 的判断改成"也算到期" → 遗留项那条应报"未调度项进了队列"。
- 把 due 计数改成各页面各自算 → "显示数字与队列长度不一致"那条应红。

## 3. 阶段 B —— 多课共存与切回（P0）

新建 `e2e/multi-lesson-continuity-journey.spec.ts`。

**为什么值得做**：真实用户一天学 2–3 个视频。这个区域**出过真 bug**（重开课程时播放时钟没启动，导致字幕完全不跟随 —— `ECHO-20260924-RESTORE-CLOCK-V1`），而且只有"离开再回来"的路径才会暴露。现有 spec 基本都是单课。

**旅程步骤**
1. 全新 guest。课 A 用内置 Sample（或本地音频 + SRT，`e2e/fixtures/` 里有现成的合成 WAV/SRT 做法，参考 `local-audio.spec.ts`），学到中途（有位置、有高亮、存了至少 1 个词、跑过一次 AI 分析或至少打开过面板）。
2. 导航去 Dashboard → 开课 B（另一份素材）→ 学到另一个位置 → 存 1 个不同的词。
3. 回 Dashboard：两个 session 都在列表里，各自的学习记录数正确。
4. **回到课 A**：断言播放位置、当前高亮行、词表归属都在；A 的词没有跑到 B 名下（`sourceVideoId` 正确）。
5. 删除其中一个 session：另一个不受影响，其词/句仍然在。
6. 刷新（reload）后重复第 4 步 —— 这条专门盯"重开课程"那条老 bug 的回归。
7. 若时间允许，加一条跨课复习：Review 队列里同时出现 A、B 的词，各归各的 `sourceVideoId`。

**注意事项**
- `echolearn_session` 与 `echolearn_sessions_list` 都要看，别只盯一个。
- 别用固定 `waitForTimeout` 拖延，学 `guestMode.ts` 那样 poll 真实 DOM 状态。
- 合成音频那套坑（1000 Hz WAV 会被 Chromium 拒绝、用 8000 Hz；合成 WAV 时长要覆盖字幕时间轴，否则"seek"没有意义）在 `local-audio.spec.ts` 和 `PROGRESS.md` 里都记过，先读再写。

## 4. 阶段 C（可选，A/B 做完且绿了再做）

按价值排序，每条独立成 spec，做完一条提一次：
1. **设置页换设备旅程**：导出全量 → 清 localStorage → Gist PAT 恢复 → 数据回来。`SettingsPage.tsx` 有 1363 行，**E2E 覆盖为零**（只有 `src/pages/__tests__/SettingsPage.test.ts`）。
2. **Dashboard 数字一致性**：Dashboard ↔ Vocabulary ↔ Sentences ↔ Review 四处数字对拍（`DashboardPage.tsx` 1163 行，无独立 E2E）。
3. **新用户前 3 分钟**：跟着新手引导 tour 走完（不是跳过），首次点词、首次保存。`first-run-journey.spec.ts` 只测了"能跳过"。
4. **词典递归探索**：在释义里再点一个词，连点 5 个词，弹窗开着时播放继续。
5. **离线完整闭环**：打开已缓存的课 → 断网 → 点词（词典必然失败）→ 保存 → 恢复网络 → 同步。

## 5. 测试写法纪律（本仓库的文化，违反会被打回）

- **从用户入口进入**，不要直接调内部函数、不要靠 `data-testid` 抄近路（除非该 testid 本来就是给 E2E 用的公开契约）。
- **先 falsify 再声称覆盖**：新断言必须证明它在旧行为下会变红，并在报告里给出失败原文。
- **网络必须为零**：guest 旅程不允许发出任何真实请求。词典、AI、Firebase 全部 route-mock。**不得产生任何 DeepSeek / ASR / Supadata 花费**；确需真实网络的部分先停下来问人。
- **locator 必须限定可见元素**：桌面视口下移动端面板会以**隐藏副本**形式存在于 DOM，`getByText(...).first()` 会命中隐藏副本（今天刚因为这个修过一个 spec，`79811f1`）。用 `.filter({ visible: true })` 或 `:visible`。
- **不要为了过测试改产品代码**。如果发现真 bug：先写一条会红的 spec 钉住它，停下来报告，等人决定怎么修。
- **行尾陷阱**：本仓库 md 文件基本是 CRLF，`core.autocrlf=true`。Edit 类工具会把整个文件重写成 LF 且 `git diff` 看不出来。改完 md 后统计一次 CRLF/LF 计数，必要时整体转回 CRLF。此坑已踩过三次。
- **CI 预算**：`.github/workflows/ci.yml` 的 e2e job 是 `timeout-minutes: 15`。全绿的一轮约 7m44s，但只要有 flaky 用例重试就会逼近上限（今天 `59d4361` 就跑到 13m33s 被切断）。**新增 spec 后要单独计时**；如果整轮超过 ~12 分钟，不要硬塞 —— 停下来，提出"把 journey 级 spec 拆成独立 Playwright project + 夜间 scheduled workflow"的方案（仓库里已有 `Uptime Monitor` 的 scheduled workflow 可照抄），**改 CI 前必须得到授权**。

## 6. 门禁（每个阶段结束都要全绿，并给出实测数字）

```
npx tsc -b
npm run lint          # 期望 0 error / 12 warning（基线不变）
npm test              # 期望全绿，报告总数
npm run build
npx playwright test e2e/review-multi-day-journey.spec.ts --project=desktop-chromium
npx playwright test e2e/multi-lesson-continuity-journey.spec.ts --project=desktop-chromium
# 最后整轮计时：
npm run e2e
```

## 7. 交付物与报告

1. 两个（或更多）新 spec 文件，命名沿用现有风格。
2. 在 `PROGRESS.md` 顶部追加一条 `ECHO-YYYYMMDD-HHMM` 条目，写清：场景、为什么现在才测、每条断言 falsify 的失败原文、门禁实测数字、以及**诚实边界**（比如"没有真机验证""没有 Production 行为验证"）。
3. 在 `TEST_REPORT.md` 追加同名条目，给出逐条证据。
4. 报告里明确区分"我实测的"和"commit message 自述的"，不要把别人的自述写成已验证事实。
5. **未经批准不要 commit / push / deploy。** 把改动留在工作区，等人授权。

---

## 8. 明确不要做的事

- 不要动产品代码（除非走第 5 条"发现真 bug"流程）。
- 不要动 `.github/workflows/ci.yml`（除非就 CI 预算另获授权）。
- 不要跑任何会产生真实花费的请求。
- 不要在 Production 上跑测试。
- 不要顺手"整理"文档或重构不相关的文件。
