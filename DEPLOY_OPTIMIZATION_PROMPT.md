# EchoLearn 生产就绪（上线推广）优化 Prompt

> 复制下面引号内的内容，发给目标 agent 即可。

---

"""
你是高级全栈工程师。请对 **EchoLearn** 项目做"生产就绪 / 公开推广"优化。不要破坏现有功能，改动后必须能通过 `npm run build`。

## 项目背景
EchoLearn 是一个基于 YouTube & Bilibili 的英语学习工具：粘贴视频链接 → 抓取字幕 → DeepSeek 按 CEFR 等级推荐词汇/句子 → 间隔重复复习。已上线 PWA + Android APK（echo-learn.uk）。

## 技术栈
React 19 · TypeScript · Vite 8 · Tailwind 4 · Firebase Auth & Firestore · Capacitor 8（Android）· DeepSeek API · Cloudflare Workers · Vercel Edge/Serverless Functions。

## 关键参考（已有良好范式，请沿用其安全思路）
- `api/ai.ts`：DeepSeek 的**服务端代理**已正确实现——服务端持有 key（`process.env.DEEPSEEK_API_KEY`），带 per-IP 限流、模型白名单、载荷字段白名单、max_tokens 上限、CORS 仅放行已知域名。把它当作安全范本。
- `firestore.rules`：已按 `users/{uid}/...` 做好用户隔离，保持不变。

## 已知问题与优化任务（按优先级）

### P0 — 上线前必须完成
1. **密钥治理（git 泄漏）**：`.env.production` 当前被 git 跟踪（公开仓库 Shmily0826/EchoLearn）。请：
   - 将其从版本控制移除（`git rm --cached .env.production`）并加入 `.gitignore`；
   - 审查其中是否含 `VITE_YOUTUBE_API_KEY` 等真实密钥；
   - 如有，改为**服务端代理模式**（仿 `api/ai.ts`），并提示用户在 GCP 轮换该 key 且限制 HTTP referrer 为 `echo-learn.uk`。
2. **`VITE_YOUTUBE_API_KEY` 前端直连**：`src/services/youtubeApi.ts` 用 `import.meta.env` 直连 YouTube Data API v3，密钥会暴露在前端 bundle。请改为走服务端函数（代理持有 key + 限流 + CORS 限制 + 载荷白名单），前端只调 `/api/...`。
3. **合规风险**：字幕抓取链路（InnerTube / Invidious / Piped / 扒 `ytInitialPlayerResponse`）可能违反 YouTube 服务条款。请评估风险，在代码注释或 README 给出合规说明与降级方案（如：改用官方 YouTube Data API 仅抓取本人视频字幕，或明确标注风险）。
4. **隐私政策 + 服务条款**：项目收集用户账号与学习数据，且用 Google OAuth 登录。请生成 Privacy Policy 与 Terms of Service 文案（或模板），并接入应用（至少提供可访问的静态页 + 在 OAuth 同意屏配置 URL）。

### P1 — 推广初期补齐
5. **限流补全**：`/api/yt`（Edge）与 `/api/transcript`（Node）目前只有 CORS、无限流。请参照 `api/ai.ts` 增加服务端限流；规模化建议用 Upstash / Vercel KV 做全局限流（而非 per-Edge 实例内存）。
6. **Firebase 成本与备份**：确认套餐（Spark / Blaze），给出账单告警配置说明，以及 Firestore 自动备份/导出方案。
7. **可观测性**：接入错误监控（如 Sentry）与基础产品分析（如 PostHog / Plausible），注意不要采集 PII。
8. **APK 分发**：因字幕抓取可能违反 Play 政策，Google Play 大概率拒审。请提供 GitHub Releases / 自建下载页的分发方案（含安装安全警示文案）。

### P2 — 锦上添花
9. **README 同步**：文档里写的 `VITE_DEEPSEEK_API_KEY` 已过时（实际用服务端 `DEEPSEEK_API_KEY`），请修正。
10. **密钥管理统一**：本地 `API-key.txt` 虽已被 gitignore，但建议移除并统一收进 `.env` 体系。
11. **Onboarding**：为首次使用的用户增加简短引导。

## 约束
- 保持 `api/ai.ts` 的硬化模式作为安全范本，不要弱化它。
- 不降低现有字幕抓取成功率（在合规前提下）。
- 所有改动在 Craft 模式产出可运行代码，并通过 `npm run build` 与 `eslint`。

## 验收标准（完成后逐项核对）
- [ ] `git ls-files` 不再出现 `.env.production`；
- [ ] 前端构建产物（dist/）中不再包含任何真实 API key（仅含可公开的设计值，如 Firebase web config）；
- [ ] YouTube Data API 调用改为服务端代理，前端无密钥；
- [ ] `/api/yt`、`/api/transcript`、`/api/ai` 三个公开端点均有服务端限流；
- [ ] 隐私政策与条款页可访问；
- [ ] `npm run build` 与 `npm run lint` 通过；
- [ ] 输出一份变更清单（改了哪些文件、为什么、遗留风险）。
"""

---

## 使用建议
- 若目标 agent 偏英文，我可以把上面引号内内容翻译成英文版。
- 如果你只想先修 P0 的安全项，我也可以把 prompt 精简成"只做密钥治理 + YouTube key 服务端化"的短版。
