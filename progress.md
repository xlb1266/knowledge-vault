# 当前对话进展（progress）

> 更新：2026-07-17
> 用途：本文件记录最近一次对话的进展状态，方便新开对话直接接手。项目全貌见 [HANDOVER.md](HANDOVER.md)，方案F 细节见 [HANDOVER-F.md](HANDOVER-F.md)。

---

## 一、当前停在哪里

**状态：方案F（Wiki 蒸馏层 + 问答助手）已全部实现并自测通过，前后端服务正在运行，用户正在浏览器端验证中。**

- 后端：http://localhost:3001 ✓ 运行中（`node --watch`，后台任务 ID `b5wr5wgoj`）
- 前端：http://localhost:5173 ✓ 运行中（vite，后台任务 ID `bto3kily0`）
- 蒸馏产物就位：`server/data/kb-wiki/wiki/topics/` 下 8 个知识页、20 处交叉链接、0 断链
- **用户验证结果尚未反馈** -- 新对话开头先问「上次让你验证方案F，结果怎样、有没有报错或异常现象」

---

## 二、本次对话已完成的事项

1. **恢复上下文**：从压缩总结重建方案F 全貌（蒸馏引擎 + 问答助手 + SSE + 前端）
2. **生成方案F 专题交接文档** [HANDOVER-F.md](HANDOVER-F.md)：11 节，含背景决策/架构数据流/文件清单/蒸馏细节/问答细节/frontmatter schema/API/验证方式/7条陷阱/后续规划。内容已对照实际代码和蒸馏产物核对
3. **更新 [HANDOVER.md](HANDOVER.md) 第十节**：补 PLAN-F.md 与 HANDOVER-F.md 指引，与专题文档互链
4. **启动后端服务**：端口 3001，`/api/health` 验证返回 ok，wiki 文件树 API 正常
5. **启动前端服务**：端口 5173，HTTP 200
6. **排查 Cannot GET**：用户访问的是后端 3001（只有 `/api/*` 路由，根路径返回 Cannot GET），前端页面在 5173 -- 已启动前端解决

---

## 三、关键决策（方案F，已落地）

### 1. 问答助手检索 wiki 层，不是 raw（★最重要，用户明确纠正）
原话要点：raw 是未加工文档，必须先 AI 按 AGENTS.md 规则加工放 wiki；加工后知识要互相关联（[[wikilink]]）；加工后仍保留 description；问答助手检索 wiki 层（两阶段：预筛 description -> 读正文 -> 流式答题 + 引用）。
**接手人切勿回退到「检索 raw」的方案。** 详见 [HANDOVER-F.md](HANDOVER-F.md) 第一节。

### 2. Obsidian / Karpathy LLM-wiki 方法论
raw（未加工源）-> AI 蒸馏 -> wiki（交叉链接知识页）。Karpathy 一手出处未能联网检索到（WebSearch 美国区无命中），**未杜撰来源 URL**，蒸馏规则用项目既有 AGENTS.md。

### 3. SSE 流式输出 + 多轮对话（用户 AskUserQuestion 选定）
问答逐字流出、支持多轮（保留最近 4 轮）。蒸馏也走 SSE 进度（"合成 xxx(3/8)..."）。

### 4. SSE 断开检测必须用 `res.on('close')`，不是 `req.on('close')`
Node 24/Express 5 下后者在请求体读完后立即触发，误判中止导致只发第一个事件。这是方案F 最隐蔽的坑。

### 5. ai-client.js 独立于 classifier-ai.js
新开共享 AI client 给 distill/qa 用，读相同 env 但独立 init，**不碰已验证的分类逻辑**（零回归）。未来可统一收敛。

### 6. 断链降级 + 重蒸馏只清 AI 页
- `sanitizeLinks`：不在标题集的 `[[x]]` 降级为纯文本 -> 实测 0 断链
- `clearAIPages`：重蒸馏只删 `ai_generated:true` 的页，手动页保留

### 7. 预筛模糊匹配 + 兜底
AI 预筛返回的标题可能与实际 wiki 标题不精确一致，用 `includes` 双向模糊匹配；全落空则兜底取前 N 页，保证始终有素材可答。

---

## 四、未完成的待办

### A. 等用户反馈验证结果（当前阻塞点）
用户正在浏览器验证方案F。新对话先确认：
- 问答助手能否正常流式答题 + 出引用卡 + 点击跳转
- 蒸馏按钮能否跑流式进度（如要重跑，3-4 分钟）
- 有无报错/异常现象

若验证发现问题，按 [HANDOVER-F.md](HANDOVER-F.md) 第九节陷阱排查（尤其 res.on('close')、中文 curl 用 --data-binary）。

### B. 后续规划（未实现，需用户确认才能动工）
- **嵌入向量检索**：当前 description 拼接预筛，上千条后需换向量（改造点在 qa.js 的 `selectRelevant`）
- **知识图谱可视化**：基于 `related` + `[[wikilink]]` 画关系图
- **蒸馏增量更新**：当前每次全量重跑，可改为只处理新增 raw
- **更多平台采集**：知乎、少数派、GitHub Stars
- **找 Karpathy LLM-wiki 一手出处**，对照修订 AGENTS.md 蒸馏规则

---

## 五、新对话接手第一步

1. 先问用户：上次方案F 验证结果如何、有无异常
2. 若服务已停，按 [HANDOVER.md](HANDOVER.md) 第五节启动（后端 `node --watch server/src/index.js`，前端 `npx vite --host`）
3. 快速自检：
   - `curl http://localhost:3001/api/health` 返回 ok
   - `ls server/data/kb-wiki/wiki/topics/` 应有 8 个 .md
   - 前端 http://localhost:5173 可打开
4. 读 [HANDOVER-F.md](HANDOVER-F.md) 第九节陷阱再动手改代码
5. 当前后台任务（若仍在运行）：后端 `b5wr5wgoj`、前端 `bto3kily0`
