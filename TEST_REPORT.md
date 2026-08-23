# EchoLearn 单元测试报告（2026-08-22，更新于 2026-08-23 晚）

> 本文件是给后续 AI agent / 开发者看的持久化测试报告。
> 状态：**291 单元用例 + 1 条 E2E 黄金路径 + CI 门禁 + 每日拨测，全部在线**。

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

- `youtubeTranscript.ts` 多级回退链（需 mock fetch，价值最高的下一层）
- `api/`、`cf-worker/`、`vps-ytdlp/` 后端逻辑
- 页面组件（StudyPage 等，待拆分后再测）
- E2E（Playwright，黄金路径 2–3 条）

## 给后续 agent 的注意事项

- `aiRateLimit.ts` 有模块级状态：测试通过 `vi.resetModules()` + 动态 import 隔离，改造成单例导出时需同步调整测试写法。
- storage 测试硬编码了 localStorage 键名（`echolearn_vocabulary` 等）——这是有意的契约锁定，改键名时测试会报警。
- 测试文件位于 `src/` 内，会被 `tsc -b` 类型检查覆盖（已验证通过）。

## 当前 git 状态

分支 `main`，本次测试相关改动**未 commit**（含 `vitest.config.ts`、`src/test/`、各 `__tests__/`、`TEST_REPORT.md`、package.json/lock）。用户工作区原有的 6 个文件未提交改动未受影响。
