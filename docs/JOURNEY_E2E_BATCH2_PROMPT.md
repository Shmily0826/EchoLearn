# 第二批任务书：把真实用户旅程的覆盖面补完（可直接复制给执行 agent）

自包含文档，不需要本仓库之外的上下文。

---

## 0. 先读这段（上一批的成果与当前基线）

仓库 `D:\CODE\project\EchoLearn`，分支 `main`。上一批成果（两个 journey spec、`mediaClock.ts`、media-sync import、`PROGRESS.md`/`TEST_REPORT.md` 的 `ECHO-20260928-JOURNEY-E2E-V1` 条目）**已作为独立 commit 提交在 main 上**，执行前先 `git log --oneline -3` 确认包含该 commit 且工作区 clean。本批的新 spec 是**新增文件**，不要改动上一批的两个 journey spec（任务 6 的清单范围除外，它只碰 4 个老 spec）。

已核实为真的基线（**不需要你重新验证**）：

- `npm test` = **981/981（77 files）**；`eslint` = 0 error / 12 warning（**基线，不可变动**）；`tsc -b` 0 错误。
- 整轮 `npx playwright test` = 约 **525s / 8.75 分钟**。CI 的 e2e job 上限 **15 分钟**。
- `mobile-pwa.spec.ts:101` 在 Windows 本地 WebKit 上稳定失败（skip link 焦点）。**与你的改动无关，不要去修**：mobile project 的 `testMatch` 只匹配 `mobile-pwa.spec.ts`。
- 现有可复用基建：`e2e/helpers/guestMode.ts`（`enterGuestMode`）、`sessionFixture.ts`（`openSignedInApp` + `SYNTHETIC_IDENTITY`，用假身份进登录态、**不发真实请求**）、`mockDictionary.ts`、`mediaClock.ts`（`setControlledMediaTime`，假时钟绕开不可 seek 的 fulfilled 媒体）。

**重要机制（上一批踩出来的，别再踩）**：
- `route.fulfill` 出来的媒体 `seekable` 恒为 `[0,0]`，**加 `Content-Length`/`Accept-Ranges` 也没用**。要控制时间轴用 `setControlledMediaTime`；要自然播放就起始 cue 放在 2 秒。
- `App.tsx` 六个页面**常驻挂载**（`visitedRoutes` state 在第 50 行，六页条件渲染在 110-140 行，`display:none`），所以 SPA 内导航**不会**让页面 remount。只有 `page.reload()` 才是真正从零挂载。
- 桌面视口下移动端面板以**隐藏副本**存在于 DOM。locator 一律 `filter({ visible: true })`。
- `page.addInitScript` **每次导航都会重跑**。种子要幂等（加 sentinel），否则后续导航会把 UI 创建的记录覆盖掉。

---

## 贯穿全部任务的红线（违反即作废）

1. **不得修改 `src/` 下任何文件**（falsify 期间临时改也必须还原，收尾用 `git status --porcelain -- src/` 自查，输出必须是空）。
2. **不得修改 `.github/workflows/`**（任务 7 要求的是把 workflow 草稿写进 docs，不是写进 workflows 目录）。
3. **绝对不要点 Settings 里的「删除账号」**——它会真的删 Firebase 账号，不可逆。
4. **绝对不要使用真实 GitHub PAT 或真实 GitHub/Gist 账号**。Gist 相关的所有请求必须 `page.route` mock。
5. **不得使用 `docs/QA_ACCOUNTS.md` 里的真实 QA 账号**，除非有人明确授权。需要登录态就用 `sessionFixture.ts` 的 synthetic identity。
6. **不得产生任何真实 provider 花费**（DeepSeek / Groq ASR / Supadata / 词典付费层）。一律 route-mock。
7. **不得在 Production 上跑测试。**
8. **每条新断言必须有 falsify 证据**：证明它在被破坏时真的会红，并记录失败原文。只绿不红的断言不算交付。
9. **行尾陷阱**：仓库 md 是 CRLF、`core.autocrlf=true`，Edit 类工具会把整个文件重写成 LF 且 `git diff` 看不出来。改完用字节统计确认（孤立 LF 必须为 0）。上一批已两次踩到 heredoc 被截断，**写脚本请用 Write 工具落盘再执行，不要用多行 heredoc**。
10. 未经批准不 commit / push / deploy。

---

## 批 1 — 真实用户旅程（P0，先做这三个）

### 任务 1：换设备旅程 —— 导出 → 清空 → 备份恢复

**新建** `e2e/settings-device-migration-journey.spec.ts`

**为什么**：`SettingsPage.tsx` 有 1363 行，包含数据导出（词/句/全量）、GitHub Gist 备份/恢复、CEFR 等级、语言、重发验证邮件等，**E2E 覆盖为零**（只有 `src/pages/__tests__/SettingsPage.test.ts` 单测）。真实用户换手机走的就是这条路。

**旅程**：
1. guest 进入，造出可验证的数据（词 + 句各若干，其中一个词通过真实 UI 保存）。
2. Settings → 数据导出（词汇 / 句子 / 全量三个动作都走一遍），断言导出的条数与实际条数一致，导出的 JSON 可解析且含预期字段。
3. 清空本地（`localStorage` 里 `echolearn_*`），刷新，断言库确实空了。
4. 通过 **route-mock 的** Gist 备份 → 恢复，断言数据回到与导出前**逐条一致**（条数 + 关键字段），且 Dashboard / Vocabulary 的数字同步正确。
5. 反向断言：恢复失败（mock 成 500 或返回坏 JSON）时，**必须给出错误且不得清空或损坏现有数据**。

**Falsify 判据**：让恢复路径少写一条（或导出少一条），第 4 步的条数断言必须红；让失败路径顺手清空存储，第 5 步必须红。

### 任务 2：Dashboard 四处数字一致性

**新建** `e2e/dashboard-consistency-journey.spec.ts`

**为什么**：`DashboardPage.tsx` 有 1163 行、三个 recharts 图表，**没有独立 E2E**。这个仓库真实出过"显示的 due 数字与按钮实际建出来的队列不一致"，根因是六处各自算"到期"。现在 `src/utils/reviewSchedule.ts` 是唯一真源——用测试把它钉住。

**做法**：参数化构造至少 4 种库状态，每种都断言 **Dashboard 的 due 数 == Review 落地页的 due 数 == Review 按钮实际建出的队列长度**，并且 Vocabulary / Sentences 的总数与各自页面显示一致：
- 全 mastered（长周期内）→ 应为 0
- 全 `nextReviewAt: 0` 且未 mastered（遗留未调度）→ 应为 0，且**断言这些行没有被批量改写**
- 混合（部分到期、部分未到期、部分 mastered 到刷新期）
- 空库 → 应显示空态而不是 0 或崩溃

**Falsify 判据**：把某一处的判定改成自己的算法（例如 Dashboard 直接用 `nextReviewAt > 0` 而不看窗口），对应那条必须红。

### 任务 3：新用户的前 3 分钟 —— 跟着引导走完

**新建** `e2e/newcomer-first-run-journey.spec.ts`

**为什么**：`first-run-journey.spec.ts` 只测了"能跳过语言选择、引导不挡路"，从没测过**跟着引导走完**。这是流失率最高的三分钟，`FirstTimeTour.tsx` + driver.js 的每一步都无人验证。

**旅程**：全新 context（不清 storage）→ 语言选择 → 引导第 1 步到结尾逐步推进（driver.js 的 next / done，注意 `.driver-overlay` 与高亮锚点）→ 断言每步指向的元素真实存在且可见（不是指向隐藏副本）→ 结束后进入 Study → 首次点词 → 首次保存 → 断言词进入 Vocabulary。再断言引导完成标记写入、**刷新后不再弹**。

**Falsify 判据**：把引导某一步的锚点改成不存在的选择器，对应的可见性断言必须红。

---

## 批 2 — 真实用户旅程（P1，批 1 全绿后再做）

### 任务 4：词典递归探索

**新建** `e2e/dictionary-recursive-exploration.spec.ts`

README 把 "recursive word exploration" 列为特性：点词 → 释义里再点一个词 → 再点。现有 `dictionary-*.spec.ts` 只覆盖失败与语义，没人测过递归。旅程：连点 5 个不同词（含一次从释义内进入的二级查询）、弹窗开着时播放继续不停、弹窗内保存 → 词表更新。Falsify：让二级查询不回填 → 断言必须红。

### 任务 5：离线完整闭环

**新建** `e2e/offline-study-journey.spec.ts`

现有 `mobile-pwa.spec.ts` 只测"离线 shell 不崩"。真实场景是飞机上打开已缓存的课。旅程：打开课程 → `context.setOffline(true)` → 点词（词典必然失败，界面必须说"查不到/服务不可用"而**不是崩溃或空白**）→ 保存（必须成功，本地优先）→ 恢复网络 → 断言数据仍在且同步状态正确。Falsify：让离线保存抛错 → 断言必须红。

---

## 批 3 — 加固（P0，我认为价值最高的一条）

### 任务 6：空转断言普查

**修改**：`e2e/` 下已有的跨页 journey spec（范围限定这 4 个，不要扩大）：
`real-learning-flow-journey.spec.ts`、`integrated-journey-campaign.spec.ts`、`review-study-continuity-campaign.spec.ts`、`learner-friction-fix.spec.ts`

**为什么**：这个仓库已经发现过**两条恒真断言**——一条是 `??` 回落成 `expect(x).toBe(x)`，一条是断言的对象在断言时已不存在。恒真断言比没有测试更糟，因为它提供假的安全感。

**做法**：逐条 `expect(...)` 判断它能不能失败。对每一条，问"什么改动会让它红？"，然后**真的改一下去验证**（改测试自身或其依赖的 fixture 值即可，不必改产品代码）。把结果整理成清单：

| 文件:行号 | 断言 | 能否变红 | 若恒真：原因 + 建议改法 |

**交付**：
- 一份清单（写进 `TEST_REPORT.md` 的新条目里，或独立成 `docs/E2E_ASSERTION_AUDIT.md`）
- **就地修掉**能明确修的（例如把 `??` 回落换成一个删除前捕获的常量），修一条就验证一条
- 明确区分"已验证会红"和"我判断会红但没实测"——**不要把没实测的写成已验证**

**Falsify 判据**：你修过的每条断言，都要给出"破坏后变红"的原文。原报告承认过有断言 falsify 没红——遇到同样情况**如实记录机制，不要硬凑**。

---

## 批 4 — 基建预案（只写文档，不动 workflow）

### 任务 7：CI e2e 预算分流预案

**新建** `docs/CI_E2E_BUDGET_PLAN.md`（**不要**写进 `.github/workflows/`）

现在整轮 525s，距离 CI 的 15 分钟上限只剩约 5 分钟。批 1+批 2 会再增加 5 个 journey spec（每个约 15-25s，加上 CI 的 retry 会更多）。写一份预案，内容：
- 现状数字与测量方法（怎么拿到整轮耗时）
- 触发条件：整轮超过 **12 分钟**就必须走分流
- 方案 A：新增独立 Playwright project（如 `journey`），PR CI 用 `testIgnore` 排除，夜间 scheduled workflow 跑
- 方案 B：按目录分片并发（注意本仓库 `workers: 1`、`fullyParallel: false`，分片比提并发更安全，因为多个 spec 都依赖 5173 单实例）
- 方案 A 的 **workflow YAML 草稿**（放文档里，标注"未部署、需授权"）
- 每个方案的取舍与风险

仓库里已有 scheduled workflow 的先例（`Uptime Monitor`），可以照抄其触发写法。

---

## 执行节奏与门禁

- **一次只做一个任务**，每个任务完成后立刻跑门禁，绿了再做下一个。
- **每完成 2 个新 spec 就整轮计时一次**。整轮超过 **12 分钟**就停下来报告（并指向任务 7 的预案），不要硬塞进现有 CI job。
- 每个任务的门禁：

```bash
cd /d/CODE/project/EchoLearn
npx tsc -b                     # 0 errors
npm run lint                   # 0 errors / 12 warnings（基线不可变）
npm test                       # 981/981
npm run build                  # PASS
npx playwright test e2e/<新 spec>.spec.ts --project=desktop-chromium
git status --porcelain -- src/  # 必须是空
```

**环境（Windows 已知坑）**：

```bash
# Playwright 的 webServer 冷启动会挂在 safe-delete shim 上
rm -rf node_modules/.vite/deps
npx vite --port 5173 --host 127.0.0.1        # 后台起，reuseExistingServer 会接管

# 本机缺 Playwright 自带 Chromium 时：
ECHOLEARN_E2E_BROWSER_CHANNEL=chrome npx playwright test e2e/<file>.spec.ts --project=desktop-chromium

# 单用例 spec 本地约 5-6 分钟墙钟；exit code 可能是环境产物，
# 读输出里的 `ok N` / `x N`，不要读 exit code
```

跑完记得杀掉 5173 上的进程（`netstat -ano | grep :5173` 找 PID，再用 PowerShell 的 `Stop-Process -Id <pid> -Force`；Git Bash 里 `taskkill /F` 需要写成 `//F` 且经常仍然失败）。

---

## 交付物与报告

1. 每个任务一个独立 spec（任务 6 是清单 + 就地修复，任务 7 是文档）。
2. 更新 `PROGRESS.md` / `TEST_REPORT.md`：**新增** `ECHO-20260928-JOURNEY-E2E-BATCH2` 条目（不要改已存在的 `ECHO-20260928-JOURNEY-E2E-V1`），保持 CRLF。写清：场景、为什么现在才测、每条 falsify 的红/绿原文、门禁实测数字、以及**诚实边界**（没真机、没 Production 验证的都要写明）。
3. 报告里明确区分"我实测的"和"我推断的"；没跑的命令不要写成跑过了。
4. 全部改动留在工作区，**不 commit / 不 push**，等授权。

建议的 commit message（获批后用）：
`test(e2e): cover device migration, dashboard consistency, first-run tour, recursive dictionary and offline journeys`
