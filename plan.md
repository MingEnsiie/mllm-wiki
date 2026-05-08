# Plan：向 NotebookLM 对齐的能力增补规划

**状态**：执行中（Phase 1 ✅ Phase 2 ✅ Phase 3 ✅ Phase 4 ✅）
**目标**：在保留当前 LLM Wiki 核心资产（持久化 Wiki、知识图谱、深度研究、Lint、Web Clipper、多格式摄入）的前提下，补齐 NotebookLM 最具差异化的用户体验，使本项目同时具备「Wiki 化长期知识库」与「Notebook 化单项目研读工作台」两种形态。
**非目标**：
- 不重写现有 Ingest / Chat / Graph 管线，所有新增能力**叠加**在现有架构之上。
- 不替换当前 LLM / Embedding 提供商抽象。
- 本轮不做账号体系、云端同步与多人协作。

---

## 一、NotebookLM 能力盘点与差距分析

### 1.1 NotebookLM 代表性能力

| 类别 | 能力 | 说明 |
|------|------|------|
| Sources | 多类型源（PDF / DOC / TXT / MD / URL / YouTube / Google Docs / 粘贴文本） | 以「Notebook」为边界的源集合 |
| Sources | 单源自动摘要 + 关键主题 + 建议问题 | 导入后立即给出 Source Guide |
| Sources | 引用精准定位（点击引用高亮原文段落） | 强可追溯 |
| Chat | 基于选中源的 grounded Q&A | 可选择「只用某些源」回答 |
| Chat | 对话建议问题（Suggested Questions） | 降低冷启动 |
| Studio | Audio Overview（双主持人播客） | 旗舰体验 |
| Studio | Video Overview（讲解式视频） | 较新 |
| Studio | Mind Map（思维导图） | 交互式树状展开 |
| Studio | Study Guide（学习指南，含测验题） | 结构化学习制品 |
| Studio | Briefing Doc（行政简报） | 一页纸摘要 |
| Studio | FAQ | 问答清单 |
| Studio | Timeline（时间线） | 时序提取 |
| Studio | Table of Contents | 结构目录 |
| Notes | 用户笔记，可转为源 | 写作闭环 |
| 协作 | 分享 Notebook / 公开链接 | - |
| 其它 | 多语言、移动端、离线阅读 | - |

### 1.2 与当前项目逐项对齐

| NotebookLM 能力 | 本项目现状 | 差距 | 处理策略 |
|---|---|---|---|
| 多格式源导入 | ✅ PDF/DOCX/PPTX/XLSX/图片/剪藏 | URL/YouTube/粘贴文本 | **补齐**（Phase 2） |
| 单源摘要+主题+建议问题 | 部分：有 source 摘要页 | 缺关键主题、建议问题、阅读指南 | **补齐**（Phase 1） |
| 引用精准定位 | 聊天有 citations 面板 | 无点击跳原文高亮 | **补齐**（Phase 3） |
| 源过滤式 Q&A | 无（全 Wiki 检索） | 缺「仅用选定源」模式 | **补齐**（Phase 3） |
| 建议问题 | 无 | 缺 | **补齐**（Phase 1/3） |
| Audio Overview 播客 | 无 | 缺（脚本 + TTS + 播放器） | **补齐**（Phase 4，旗舰） |
| Mind Map | 有知识图谱（力导向） | 缺树状/放射思维导图视图 | **补齐**（Phase 5） |
| Study Guide | 无 | 缺 | **补齐**（Phase 6） |
| Briefing Doc | 有 overview.md | 格式/交互欠缺 | **增强**（Phase 6） |
| FAQ | 无 | 缺 | **补齐**（Phase 6） |
| Timeline | 无 | 缺 | **补齐**（Phase 6） |
| Table of Contents | 有 index.md | 可视化欠缺 | **增强**（Phase 5） |
| 用户 Notes | 无独立实体 | 有 queries/ 但非笔记 | **补齐**（Phase 7） |
| 分享 / 导出 | 无 | 缺 Notebook 打包导出 | **补齐**（Phase 8） |
| Video Overview | 无 | 低优先级，脚本复用音频 | **延后**（Phase 9，可选） |
| 移动端 | 无 | 超出范围 | **不做** |

### 1.3 本项目需要保留并强化的差异化优势（不退化）

- 持久化 Wiki（非每次重查）——继续作为 Studio 制品的数据源
- 知识图谱 + Louvain 社区 + Insights——成为 NotebookLM 没有的深度结构分析
- Deep Research + Web Clipper——成为 NotebookLM 没有的外联能力
- 两步 CoT Ingest + 摄入队列——已有稳定底座

---

## 二、整体方案与架构定位

**核心隐喻调整**：
- 保留「项目 = Wiki」，同时引入轻量「Notebook 视图」——它是当前项目在 UI 层的一种**呈现模式**，不是新存储层。
- 新增一个顶部视图切换：`Wiki 模式` / `Notebook 模式`。
  - **Wiki 模式**（现有）：知识树、图谱、Lint、审核、深度研究
  - **Notebook 模式**（新增）：Sources 列表 + Chat + Studio（音频/思维导图/学习指南/简报/FAQ/时间线）+ Notes

**存储复用**：
- Sources 复用 `raw/sources/`
- Studio 制品写入 `wiki/studio/`（新目录）：
  - `wiki/studio/audio/<id>.{script.md,mp3,meta.json}`
  - `wiki/studio/mindmap/<id>.json`
  - `wiki/studio/guides/<id>.md`
  - `wiki/studio/briefings/<id>.md`
  - `wiki/studio/faqs/<id>.md`
  - `wiki/studio/timelines/<id>.md`
- Notes 写入 `wiki/notes/<id>.md`（复用 Wiki 页面格式，可被 ingest 吸收进图谱）
- 源级元数据增强写入 frontmatter：`key_topics`、`suggested_questions`、`source_guide`

**LLM 复用**：全部走现有 `llm-client.ts` + 提供商抽象；TTS 作为独立服务抽象新增。

---

## 三、分阶段任务（Phase）

每个 Phase 独立可交付、可回滚、可关 feature flag。

---

### ✅ Phase 1：Source Guide —— 源级摘要、关键主题、建议问题

**目标**：每个 source 摄入完成后自动生成 NotebookLM 风格的 Source Guide，在右侧面板展示。

**任务清单**：
1. 在 `src/lib/ingest.ts` 第二步生成阶段，扩展 prompt 产出：
   - `summary`：150–250 字中文/英文双向摘要
   - `key_topics`：5–10 个关键主题短语
   - `suggested_questions`：5 个可直接点击提问的问题
2. 写入 `wiki/sources/<slug>.md` 的 frontmatter（新增字段）。
3. 新增组件 `src/components/sources/source-guide-panel.tsx`：
   - 顶部摘要、主题 tag 列表、建议问题（点击 → 注入 chat-panel 输入）
4. `sources/` 树节点点击后右侧 preview 切换为 Source Guide 视图（与原始预览并列 Tab）。
5. 对历史已摄入源提供「重建 Guide」按钮（调用纯 LLM 步骤，不重跑两步摄入）。
6. i18n：`zh.json` / `en.json` 增加相关文案。

**验收**：
- 新导入一个 PDF，摄入完成后 Source Guide 立刻可见，建议问题可一键提问。
- 旧源可通过按钮补建 Guide。

**预估**：3 天

---

### ✅ Phase 2：源类型扩展 —— URL、YouTube、粘贴文本

**目标**：对齐 NotebookLM 的源输入方式。

**任务清单**：
1. 在 `src/components/sources/` 新增 `add-source-dialog.tsx`，提供四个 Tab：
   - 本地文件（现有）
   - 网页 URL（复用剪藏管线：调用 Readability 后端抓取；Rust 侧实现 `fetch_and_extract_url`）
   - YouTube（提取 `videoId` → 拉字幕；Rust 侧实现 `fetch_youtube_transcript`，优先官方字幕，失败降级 whisper.cpp 本地转写，若未配置 → 友好报错）
   - 粘贴文本（直接写入 `raw/sources/pasted-<timestamp>.md`）
2. 新增 Tauri 命令：
   - `fetch_and_extract_url(url) -> { title, markdown }`
   - `fetch_youtube_transcript(url, lang) -> { title, transcript_md, duration }`
3. 统一写入 `raw/sources/` 后进入现有摄入队列。
4. YouTube 源的 frontmatter 存 `source_type: youtube`、`video_url`、`duration`，供后续 Studio 引用。

**验收**：
- 任意 YouTube 链接可在 60 秒内变成一个带字幕文本的源并被摄入。
- 粘贴 5KB 文本可正常生成 Wiki 页面。

**预估**：3 天

---

### ✅ Phase 3：Grounded Chat —— 源过滤 + 精准引用跳转

**目标**：让 Chat 对齐 NotebookLM 的「选源回答 + 点引用跳原文」体验。

**任务清单**：
1. `chat-panel.tsx` 输入框上方新增「Scope」控件：
   - `全部`（现状）
   - `已选源`（多选 Source 后启用）
   - `仅当前源`（在 Source Guide 里发起 chat 时默认）
2. `src/lib/search.ts` 增加 `scopeSources: string[]` 参数；搜索/图扩展/向量检索均按 `frontmatter.sources[]` 过滤。
3. 引用渲染升级：
   - 引用卡片显示源类型图标 + 页/段落定位（若可得）
   - 点击卡片 → 右侧预览自动打开该源并滚动高亮到对应片段（PDF：按页跳转 + 文本高亮；Markdown：按 anchor 滚动）
4. 为实现段落定位，`ingest.ts` 在两步生成时要求 LLM 产出 `[[wikilink#anchor]]`；同时 `text-chunker.ts` 输出的 chunk 追加 `anchor_id` 写入 LanceDB（新增字段，需数据迁移脚本 `migrate-chunks-v2.ts`）。
5. 每轮回答后自动生成 3 个「后续建议问题」（prompt 追加字段），展示为按钮。

**验收**：
- 多选 2 个源后发起提问，检索范围确认仅来自这 2 个源。
- 点击回答中的 `[1]` 引用，预览区跳转并高亮原文。
- 回答末尾出现 3 个可点击的后续问题。

**预估**：5 天

---

### ✅ Phase 4：Audio Overview —— 播客化音频概述（旗舰）

**目标**：一键将选定源/整个 Notebook 生成双主持人播客音频。

**子阶段 4A：脚本生成**
1. 新增 `src/lib/audio-overview.ts`：
   - 输入：`scope`（全部源 / 选定源）+ `style`（Deep Dive / Brief / Debate）
   - LLM 流程：
     - Step 1：读取相关 Wiki/source 内容（复用 context-budget）
     - Step 2：生成对白脚本 JSON：`[{speaker:"A"|"B", text:"..."}, ...]`，含开场/过渡/结尾
   - 持久化到 `wiki/studio/audio/<id>/script.md`

**子阶段 4B：TTS 合成**
1. 新增 TTS 提供商抽象 `src/lib/tts-providers.ts`，支持：
   - OpenAI `tts-1` / `tts-1-hd`（双音色：alloy + onyx）
   - Azure / ElevenLabs / 自定义 OpenAI 兼容端点
   - 本地 `edge-tts`（Rust 侧 spawn，作为无 key 兜底）
2. 按 speaker 分段调用 TTS → 得到多段 mp3 → Rust 侧用 `symphonia` + `rodio` 拼接为单文件 `final.mp3`
3. 合成过程以任务形式进入活动面板，支持取消。

**子阶段 4C：播放器 UI**
1. 新增 `src/components/studio/audio-player.tsx`：
   - 播放/暂停/倍速/下载
   - 跟随脚本高亮当前对白行（按时间戳，TTS 返回 per-segment duration 累加）
2. 设置面板新增 TTS 区：provider / key / 双音色选择 / 语言

**验收**：
- 选择 3 个源 → 点击 Generate Audio Overview → 3 分钟内生成 5–8 分钟双人播客 mp3，可播放并看到脚本高亮。

**预估**：7 天

---

### Phase 5：Mind Map + Table of Contents 可视化

**目标**：提供 NotebookLM 风格的思维导图（区别于现有力导向 Graph）。

**任务清单**：
1. 新增 `src/components/studio/mind-map.tsx`，使用 `react-flow` 或 `markmap-lib`（更轻，纯 markdown → 思维导图）：
   - 输入：LLM 根据选定 scope 产出层级 markdown（`#/##/###`）
   - 持久化：`wiki/studio/mindmap/<id>.md`
   - 交互：展开/折叠分支、点击节点打开对应 Wiki 页/源、导出 PNG/SVG
2. TOC 视图：基于 `index.md` 自动生成可折叠目录，提供「按类型 / 按社区 / 按字母」三种排序。
3. 与现有 Knowledge Graph 并列为「Graph / Mind Map / TOC」三视图切换。

**验收**：
- 点击 Generate Mind Map，10 秒内在新标签页出现可交互导图。
- 思维导图节点点击跳转到对应 wiki 页。

**预估**：4 天

---

### Phase 6：Studio 文本制品 —— Study Guide / Briefing / FAQ / Timeline

**目标**：一键生成结构化学习/交付制品。

**通用任务**：
1. 新增 `src/lib/studio/` 目录，每个制品一个文件：
   - `study-guide.ts`：生成「学习目标 + 章节要点 + 10 道测验题（含答案）+ 扩展阅读」
   - `briefing.ts`：一页纸行政简报（背景/要点/建议/风险）
   - `faq.ts`：15–25 条 Q/A
   - `timeline.ts`：时间点抽取 → Markdown 时间线 + 可视化（`react-chrono`）
2. 共用一个 `studio-runner.ts`：处理 scope 选取、context-budget、写入文件、显示生成进度。
3. UI：Notebook 模式右侧新增「Studio」抽屉，一排卡片按钮；生成后以 Tab 形式并列展示，可保��、删除、重新生成。
4. 所有制品写入 `wiki/studio/<type>/` 并带 frontmatter `scope_sources: [...]`；可被图谱/搜索索引。

**验收**：
- 每类制品对 10 个源的 Notebook 能在 60 秒内生成。
- 制品可再次被 chat 检索引用（闭环）。

**预估**：5 天

---

### Phase 7：Notes —— 用户笔记系统

**目标**：对齐 NotebookLM「Notes → Convert to source」工作流。

**任务清单**：
1. Notebook 模式左下新增 Notes 面板：
   - 新建/编辑/删除笔记，Milkdown 编辑器
   - 支持「从聊天回答一键保存为 Note」（替代当前「保存到 Wiki」按钮的默认目标）
   - 支持「将 Note 转为 Source」：写入 `raw/sources/note-<id>.md` → 进入摄入队列
2. 存储：`wiki/notes/<id>.md`，frontmatter 含 `note_type: freeform|chat_saved|study_guide_draft`
3. Notes 默认不进入知识图谱，转为 Source 后才进入。

**验收**：
- 聊天回答可一键保存为 Note，编辑后可转为 Source 并在图谱中出现。

**预估**：3 天

---

### Phase 8：Notebook 打包与分享

**目标**：导出独立可分享的 Notebook 包。

**任务清单**：
1. 新增 Tauri 命令 `export_notebook(projectPath, outPath, options)`：
   - 打包 `raw/` + `wiki/` + `wiki/studio/` + `purpose.md` + `schema.md` 为 `.llmwiki.zip`
   - 可选附带 `notebook.html`：离线静态站点（基于 Vite build 子集），嵌入 Mind Map/TOC/Chat 历史只读视图
2. 导入命令 `import_notebook(zipPath)`：反向解压为新项目。
3. 设置面板增加「导出为 HTML 静态站」选项。

**验收**：
- 导出的 zip 在另一台机器解压后可作为新项目打开，所有 Studio 制品完整。
- 导出的 HTML 在无应用环境下可浏览 Wiki 与 Mind Map。

**预估**：4 天

---

### Phase 9（可选）：Video Overview

**目标**：基于 Audio Overview 脚本 + 幻灯片合成讲解视频。
- 脚本复用 Phase 4 产物
- 幻灯片：LLM 生成 Markdown + `reveal.js` 导 PDF → 图片帧
- `ffmpeg`（Rust 侧或用户本地）合成 mp4
- 交付物放 `wiki/studio/video/<id>.mp4`

**预估**：5 天（本轮不承诺）

---

## 四、横切事项

### 4.1 UI/视图切换
- 新增顶部「Wiki / Notebook」两模式切换（右上角）。
- Notebook 模式下隐藏 Lint/Review/Deep Research 入口（移到 Wiki 模式），降低 NotebookLM 风格用户认知负担。
- 左侧栏在 Notebook 模式改为：Sources / Notes / Studio / Chat。

### 4.2 Feature flag 与渐进开启
- 每个 Phase 受控于 `settings.features.*` 布尔开关，默认仅 Phase 1/2/3 开启；Phase 4（Audio）因需 TTS Key 默认关闭。

### 4.3 数据迁移
- Phase 3 LanceDB 需加 `anchor_id` 字段：提供 `scripts/migrate-chunks-v2.ts`，首启动时检测并后台重建。
- Phase 1 新增的 frontmatter 字段缺失时由 `source-guide-panel` 动态显示「生成 Guide」按钮，不强制回填。

### 4.4 i18n
- 所有新增 UI 同步中英文案；保持 `i18n-parity.test.ts` 通过。

### 4.5 测试策略
- 单元测试：新增 lib（audio-overview / studio/* / tts-providers / youtube fetch）均附 `.test.ts`
- Real-LLM 测试（env gated）：Source Guide、Study Guide、Audio 脚本至少各一个端到端测试
- E2E：Phase 3 的引用跳转至少一个 Playwright 场景（可手动）

### 4.6 风险与成本提示
| 风险 | 说明 | 缓解 |
|------|------|------|
| TTS 成本 | Audio Overview 单次 ~¥1–3 | 默认关，明显提示 |
| YouTube 字幕抓取受限 | Google 反爬 | 优先 `youtube-transcript-api` 协议，失败降级本地 whisper |
| LanceDB schema 迁移风险 | 老数据不兼容 | 迁移脚本 + 首启动检测 + 失败回滚到纯分词搜索 |
| Studio 制品质量依赖模型 | Flash-Lite 不可用 | 在设置页为 Studio 单独指定推荐模型档位 |
| 大 Notebook 生成慢 | context-budget 超限 | 分层摘要（先合并 overview，再生成制品） |

---

## 五、里程碑排期

| 里程碑 | 内容 | 周 | 累计工作日 |
|--------|------|----|-----------|
| M1 | Phase 1 + 2 | W1–W2 | 6 |
| M2 | Phase 3 | W3 | 11 |
| M3 | Phase 4（Audio Overview） | W4–W5 | 18 |
| M4 | Phase 5 + 6 | W6–W7 | 27 |
| M5 | Phase 7 + 8 | W8 | 34 |
| M6（可选） | Phase 9 Video | W9 | 39 |

每个 M 结束：发版本 tag，更新 `README.md` / `README_CN.md` 的能力矩阵段落，录制一段 60s demo。

---

## 六、Agent 执行指引

后续 agent 可按以下顺序接单，每个 Phase 作为一个独立任务提交：

1. 先读取本文档对应 Phase 一节。
2. 在 `plans/` 下创建 `plans/<phase-name>.md`，填充该 Phase 的详细实施稿（接口签名、prompt 全文、测试用例清单）。
3. 按「任务清单」创建 TodoList，逐条完成。
4. 每 Phase 结束时更新本文档的「状态列」为 ✅，并在 `README_CN.md` 新增对应小节。

**建议起点**：Phase 1（Source Guide），因其改动最小、用户感知最强、可立即体现对齐 NotebookLM 的方向感。