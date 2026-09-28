# 交接 Prompt：修正两个 journey E2E，并把 seek 与 RESTORE-CLOCK 覆盖补上

整份文档自包含，可以直接复制给执行 agent。不需要本仓库之外的任何上下文。

---

## 0. 背景（你需要知道的全部）

仓库 `D:\CODE\project\EchoLearn`，分支 `main`，HEAD `ac2715e`。工作区目前有**未提交**的改动：

```
 M PROGRESS.md                                    # 已追加 ECHO-20260928-JOURNEY-E2E-V1 条目
 M TEST_REPORT.md                                 # 同上
?? e2e/review-multi-day-journey.spec.ts            # 阶段 A，311 行，1 用例，已绿
?? e2e/multi-lesson-continuity-journey.spec.ts     # 阶段 B，326 行，1 用例，已绿
```

这两个 spec 已经过一轮独立审计，**结论是实质工作可信、可以保留**，但审计发现了三个必须处理的问题。你的任务就是处理它们，并补上两块覆盖。**不要重写这两个 spec，只做本文列出的改动。**

审计已核实为真、你不需要重新验证的事实：
- 两个 spec 全程零网络（dictionary route-mock、`/api/ai` 与 `/api/audio-transcribe` abort、YouTube iframe 与 extraction-worker 域名拦截）。
- locator 全部 `filter({ visible: true })`；无 `test.only` / `waitForTimeout`。
- `npm test` = **981/981（77 files）**，`eslint` = 0 error / 12 warning（这是基线，不可变动）。
- 整轮 `npx playwright test` 本地约 **550s**，CI job 上限 15 分钟，尚有约 5 分钟余量。
- `mobile-pwa.spec.ts:101` 在 Windows 本地 WebKit 上稳定失败（skip link 焦点），**与这两个 spec 无关**：`playwright.config.ts` 里 mobile-chromium / mobile-webkit 的 `testMatch` 只匹配 `mobile-pwa.spec.ts`。不要去修它。

---

## 任务 1（P1）：删掉一条恒真空转的断言

**位置**：`e2e/multi-lesson-continuity-journey.spec.ts:322-324`

```ts
expect(vocab.find((v) => v.word === 'Good')!.sourceVideoId).toBe(LESSON_A_ID);
expect(vocab.find((v) => v.word === 'practice')!.sourceVideoId)
  .toBe((await readSessions(page)).find((s) => s.sourceType === 'local_audio')?.youtubeId ?? practiceItem.sourceVideoId);
```

**为什么它是空转**：执行到这一行时课程 B 已经被删除（第 290 行刚断言 `readSessions()` 长度是 1），所以 `find(s => s.sourceType === 'local_audio')` 是 `undefined`，`?? practiceItem.sourceVideoId` 把右边换成了 `practiceItem` 自己的值 —— 断言退化成 `expect(x).toBe(x)`，永远为真。

**怎么改**：在**删除 B 之前**把 B 的 id 捕获成一个常量（例如 `const lessonBId = lessonB!.youtubeId`），然后把第 323-324 行改成用这个常量做断言；同时保留"删除后 practice 词仍然存在"的断言（`toHaveLength(2)` 已经在第 289 行，不重复）。目标：这条断言必须真的能因为归属错误而失败。

**验收（必须做）**：临时把某处让 `practice` 的 `sourceVideoId` 变成 bilibili 的 id，跑这个 spec，**必须红**；还原后再跑**必须绿**。把两次的输出原文记下来。

---

## 任务 2（P2）：修三处与实现矛盾的残留注释

只改注释，不改代码。

1. `e2e/multi-lesson-continuity-journey.spec.ts:123-124`
   现在写的是 `Content-Length + Accept-Ranges make the stream seekable; a bare fulfill leaves seekable empty and every seek silently restarts from zero.`
   **这是错的**：实测加了这两个头也**不能**让 fulfilled 响应的媒体可 seek。改成如实描述：route-mock 出来的媒体永远 `seekable = [0,0]`，所以这个 fixture 的第 2 秒 cue 是靠**自然播放**到达的，不依赖 seek。

2. `e2e/multi-lesson-continuity-journey.spec.ts:188-189`
   现在写的是 `wait until playback is genuinely under way before seeking.`
   但紧跟其后（第 190-194 行）并没有任何 seek，而是等自然播放把高亮等出来。把 "before seeking" 改成真实意图（等播放真正开始，好让高亮能自然到达）。

3. `e2e/review-multi-day-journey.spec.ts:203`
   现在写的是 `// Queue order is store order: [good, seedone, great, seedtwo, seedthree].`
   但 `ReviewPage.startSession` 用 `Math.random` 洗过队列，`reviewRound()` 本身也是按卡片正面显示的词查评分表的（这正是正确做法）。这个注释既错又会误导。改成说明"队列顺序被应用洗牌，因此评分按卡片正面显示的词查表，不依赖顺序"。

---

## 任务 3（P1，价值最高）：把受控媒体时钟抽成共享 helper，并补上 seek 覆盖

**背景**：上一轮审计得出过"runtime seek 覆盖不到、这是 design limitation"的结论 —— **这个结论是错的**。仓库里早就有可用的手段，只是它被写成了局部函数：

`e2e/media-sync.spec.ts:70-83` 的 `setControlledMediaTime` 用 `Object.defineProperty` 覆盖 `<audio>.currentTime` 的 getter/setter，再 `dispatchEvent(new Event('timeupdate'))`，完全绕开 `seekable`，已经支撑着 media-sync 的 6 个用例。

**要做的事**：
1. 把这个函数（**连同它的解释性注释**）原样抽到新文件 `e2e/helpers/mediaClock.ts` 并导出。
2. `e2e/media-sync.spec.ts` 改为 import 它，删掉本地定义。**行为必须一字不变**，跑 `npx playwright test e2e/media-sync.spec.ts --project=desktop-chromium` 必须仍然全绿（6/6）。
3. 用这个 helper 给阶段 B 补一条连续性断言：**seek 之后重开课程，高亮必须重新对齐到 seek 的位置**（而不是停在旧行或第 0 行）。这是"重开课程"这个区域真正该被覆盖的部分，也是这次交付没能覆盖的。

**验收**：新增断言要有 falsify —— 让它依赖的"seek 后重新对齐"逻辑失效（例如把 seek 位置喂成一个不在任何 cue 范围内的值，或临时让对齐逻辑跳过），断言必须红。记下原文。

---

## 任务 4（P1）：让 RESTORE-CLOCK 的 falsify 真正变红（或给出它不红的证据）

**现状**：阶段 B 里"重开 B，时钟必须自走"这条断言，在把老守卫还原回去之后**依然通过**，所以它没能钉住 `ECHO-20260924-RESTORE-CLOCK-V1`。原报告的解释是"这条入口路径的 ordering 恰好无害"，方向对但没给出机制。审计已经帮你排掉了两个错误方向：

- **不是** `onPositionChange` 不稳定：`StudyPage.tsx:303` 的 `persistPlaybackPosition` 是 `useCallback(..., [])`，稳定。
- **页面是常驻挂载的**：`App.tsx:100-140` 用 `visitedRoutes.has(path)` + `display:none` 渲染六个页面，SPA 内导航不会卸载 `StudyPage` 或 `AudioPlayer`。

**因此最可能的真因**：老 bug 需要"组件真正从零挂载、且音频源（blob URL 或提取出来的音频流）晚于播放时钟 effect 首次运行才就绪"。而阶段 B 的 `page.reload()`（第 293 行）之后，它重开的是 **A（bilibili）而不是 B（local audio）** —— 走的不是那条脆弱路径。`src/hooks/usePlaybackPosition.ts:28-38` 的注释明确点名了触发条件就是 blob / extracted stream 的异步就绪。

**要做的**：
1. 在 reload 之后增加/替换成**重开 B（local audio）**并断言时钟自走。B 是本地音频、blob 来自 IndexedDB，是最接近老 bug 的形状。
2. 做 falsify：临时把老守卫 `|| !playerRef.current` 加回 `src/hooks/usePlaybackPosition.ts:38` 的条件里，重跑。
   - **红了** → 成功。用 `git checkout -- src/hooks/usePlaybackPosition.ts` 还原产品代码，再跑一次确认绿，记下红/绿两次原文。
   - **仍然不红** → 不要硬凑、不要为了变红去改断言。把结论如实写成"这条路径确实无害"，并给出你用来判定 mechanism 的证据（例如临时打印 effect 运行次数与 `playerRef.current` 的就绪时机）。同时明确写：该回归仍由已提交的 `e2e/local-audio.spec.ts:386` 钉住。

**重要**：falsify 期间改产品代码是允许的，但**必须还原**。收尾时跑 `git status --short` 自查，确认 `src/` 下**没有任何**改动残留。上一轮就是靠这一步确认干净的。

---

## 纪律（违反会被打回）

- **除 falsify 期间外，不得修改 `src/` 下任何文件。** 发现真 bug 时：先写一条会红的测试钉住它，停下来报告，不要顺手修。
- 不得修改 `.github/workflows/`。
- 不得发起任何真实网络请求，不得产生 DeepSeek / ASR / Supadata 花费。
- 不得在 Production 上跑测试。
- 所有 locator 必须限定可见元素（`filter({ visible: true })`）——桌面视口下移动端面板以**隐藏副本**存在于 DOM，`getByText(...).first()` 会命中隐藏副本。
- **行尾陷阱**：本仓库 md 与部分源码是 CRLF，`core.autocrlf=true`。Edit 类工具会把整个文件重写成 LF 且 `git diff` 看不出来。改完用字节统计确认（`git diff --stat` 若出现整文件级别的行数变化就是踩了）。
- 未经批准不要 commit / push / deploy。

---

## 环境（Windows 上的已知坑，先读再跑）

```bash
cd /d/CODE/project/EchoLearn

# Playwright 的 webServer 冷启动会挂在 safe-delete shim 上（清不掉 node_modules/.vite/deps）
rm -rf node_modules/.vite/deps
npx vite --port 5173 --host 127.0.0.1        # 后台起，reuseExistingServer 会接管

# 本机缺 Playwright 自带 Chromium 时：
ECHOLEARN_E2E_BROWSER_CHANNEL=chrome npx playwright test e2e/<file>.spec.ts --project=desktop-chromium

# 单用例 spec 本地约 5-6 分钟墙钟时间；exit code 可能是环境产物，
# 读输出里的 `ok N` / `x N`，不要读 exit code
```

跑完记得杀掉 5173 上的进程（`netstat -ano | grep :5173` 找 PID 再 `Stop-Process`；Git Bash 里 `taskkill /F` 需要写成 `//F` 且经常仍然失败）。

---

## 门禁（每条都要给出实测数字）

```bash
npx tsc -b                     # 0 errors
npm run lint                   # 0 errors / 12 warnings（基线不可变）
npm test                       # 981/981
npm run build                  # PASS
npx playwright test e2e/media-sync.spec.ts e2e/review-multi-day-journey.spec.ts e2e/multi-lesson-continuity-journey.spec.ts --project=desktop-chromium
npx playwright test            # 整轮计时；若超过 ~12 分钟就停下来报告，不要硬塞 CI
```

## 交付物与报告

1. 改动后的两个 spec + 新的 `e2e/helpers/mediaClock.ts`。
2. 更新 `PROGRESS.md` / `TEST_REPORT.md` 里已有的 `ECHO-20260928-JOURNEY-E2E-V1` 条目（**不要新增条目**，就地补充这三项修正与新增覆盖），保持 CRLF。
3. 报告里逐条给出：每个改动的 falsify 红/绿原文、门禁实测数字、以及**诚实的负结果**（尤其任务 4 若仍不红，要写清机制与证据，不要含糊）。
4. 明确区分"我实测的"和"我推断的"。
5. 全部改动留在工作区，**不 commit、不 push**，等授权。

建议的 commit message（获批后用）：
`test(e2e): fix a vacuous attribution assertion, share the controlled media clock, and cover seek continuity`
