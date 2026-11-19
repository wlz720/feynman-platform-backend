# Feynman 学习平台 · 后端

「费曼学习法」知识管理平台的 Node.js 后端：提供用户认证、知识点 CRUD 接口，代理调用百度智能云短语音识别把录音转成文字，并使用大模型对复述做润色与评分。

## 技术栈

| 用途 | 选型 |
| --- | --- |
| 运行时 / 框架 | Node.js + Express 5 |
| 数据库 | MongoDB（Mongoose 9，使用 Atlas 云实例） |
| 认证 | jsonwebtoken（JWT，7 天有效）+ bcryptjs |
| 文件上传 | multer 2（memoryStorage，不落盘） |
| 语音识别 | 百度智能云「短语音识别」HTTP 接口（axios 直接调用，未使用 SDK） |
| 大模型 | OpenAI 兼容接口（默认智谱 `glm-4-flash`，也可切到硅基流动 / 千帆文心；axios 调用，Prompt 约束 JSON 输出） |

## 目录结构

```
index.js                        入口：加载 .env、连接 MongoDB、挂载路由
routes/users.js                 注册 / 登录
routes/knowledgePoints.js       知识点增删改查（需登录）
routes/audio.js                 录音上传与识别（需登录）
middleware/auth.js              校验请求头 x-auth-token
middleware/dbGuard.js           数据库未就绪时快速返回 503，区分网络异常与业务错误
models/User.js                  用户模型
models/KnowledgePoint.js        知识点模型
controllers/baiduAiController.js  token 获取与缓存、百度识别、大模型润色与评价
services/vectorStoreService.js  RAG 向量库：文本分割、Embedding、本地存储与相似度检索
scripts/check-baidu.js          语音凭证与识别自检
scripts/check-llm.js            大模型凭证、模型权限与完整评价链路自检
scripts/check-rag.js            RAG 自检：分割 → 向量化 → 入库 → 检索全链路
```

## 快速开始

```bash
npm install
cp .env.example .env     # Windows: copy .env.example .env
# 编辑 .env，填入下方环境变量
node index.js            # http://localhost:3000
```

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `MONGO_URI` | MongoDB 连接串 |
| `JWT_SECRET` | JWT 签名密钥，自行生成随机串 |
| `PORT` | 服务端口，默认 3000 |
| `BAIDU_API_KEY` | 百度智能云语音技术应用的 API Key |
| `BAIDU_SECRET_KEY` | 同应用的 Secret Key |
| `LLM_BASE_URL` | 大模型接口地址（OpenAI 兼容），如 `https://open.bigmodel.cn/api/paas/v4` |
| `LLM_API_KEY` | 上面对应服务商的 API Key |
| `LLM_MODEL` | 模型名，如 `glm-4-flash`（高峰期限流时可换 `glm-4.7-flash`）；三项都填时优先走这条通道 |
| `QIANFAN_API_KEY` | 可选。千帆大模型应用的 API Key；新版控制台的 `bce-v3/ALTAK-…` 也填这里 |
| `QIANFAN_SECRET_KEY` | 可选。千帆应用的 Secret Key；填了 `bce-v3` 开头的 Key 时可留空 |
| `QIANFAN_MODEL` | 可选。模型名，v1 接口默认 `eb-instant`，bce-v3 接口默认 `ernie-5.1` |
| `EMBEDDING_MODEL` | 可选。RAG 向量化模型名：走 `LLM_*` 通道时默认 `embedding-2`（智谱），走千帆 bce-v3 时默认 `embedding-v1` |

百度语音凭证在控制台「语音技术 → 应用列表」中创建应用后获取，同一页面应同时出现 **AppID、API Key、Secret Key** 三项。注意不要使用「用户中心 → 安全认证」里的 AK/SK，那套无法换取 access_token。

只要 `LLM_BASE_URL + LLM_API_KEY + LLM_MODEL` 都填了，就直接走第三方 OpenAI 兼容接口（可用有免费额度的模型）；否则回落到千帆。千帆的 `QIANFAN_*` 留空时再回退使用 `BAIDU_*`，对应课件里"语音与千帆共用同一个应用"的情况。但**语音技术和千帆是两个独立的服务权限**：语音应用默认没有文心模型的调用权限，需要在千帆控制台「应用接入 → 编辑应用 → 模型服务」里勾选模型，否则接口会返回 `error_code: 6`。

## 接口

除注册、登录外，所有接口需在请求头携带 `x-auth-token: <JWT>`。

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| POST | `/api/users/register` | 注册（邮箱、用户名查重，密码加盐哈希） |
| POST | `/api/users/login` | 登录，返回 token 与用户基本信息 |
| GET | `/` | 健康检查 |
| GET | `/api/knowledge-points` | 当前用户的知识点列表（按创建时间倒序） |
| POST | `/api/knowledge-points` | 新建知识点 |
| GET | `/api/knowledge-points/:id` | 知识点详情（校验归属） |
| PUT | `/api/knowledge-points/:id` | 更新知识点 |
| DELETE | `/api/knowledge-points/:id` | 删除知识点 |
| POST | `/api/audio/transcribe` | 上传音频（字段名 `audio`，≤2MB），返回识别文本 `{ result }` |
| POST | `/api/audio/evaluate` | 请求体 `{ originalContent, transcribedText, knowledgePointId? }`，返回润色、评价、优缺点、分数；带 `knowledgePointId` 时写回该知识点的 `lastAttempt` 与复习状态 |
| POST | `/api/ai/generate-question` | 请求体 `{ knowledgePointContent, difficulty, type? }`，`difficulty` 为 `基础 / 中等 / 困难`，`type` 为 `single-choice`（默认）或 `short-answer`，返回结构化题目 |
| POST | `/api/ai/grade-answer` | 请求体 `{ question, answerKeyPoints, studentAnswer }`，返回 `{ isCorrect, explanation, studentAnswer }` |
| POST | `/api/ai/rag-qa` | 课时11。请求体 `{ question }`（≤500 字），基于当前用户向量库检索后由大模型作答，返回 `{ answer, sources }`，`sources` 为引用的知识点（含相似度与摘要） |

知识点接口会对入参做边界校验：`title` 必须是 1–200 字、`content` 必须是 1–10 万字的字符串，`status` 只接受 `not_started / need_review / mastered`，不符合返回 400。写入前还会经过 `utils/sanitizeMarkdown.js` 做存储侧消毒：删除代码块之外的原始 HTML（`<script>`、`<iframe>`、带 `onerror` 的标签等），因此恶意载荷不会进入数据库；围栏代码块、行内代码、自动链接、引用块和 LaTeX 公式保持原样，避免把教学示例也一并删掉。渲染时前端还会用 `react-markdown` + `DOMPurify` 再消毒一次，形成「入库 + 渲染」两层防护。

### 状态码约定

| 状态码 | 含义 |
| --- | --- |
| 400 | 业务校验失败，如 `邮箱或密码错误`、`邮箱已被注册` |
| 401 | 未携带或携带了无效的 `x-auth-token` |
| 422 | 语音识别返回空结果 |
| 500 | 服务端异常（非数据库连接问题） |
| 502 | 上游（百度语音 / 大模型）调用失败或返回无法解析的内容 |
| 503 | 数据库连接未就绪或查询超时；大模型凭证缺失或鉴权失败 |

MongoDB Atlas 在本地网络抖动时，驱动选主节点可能耗时数十秒；过去这段时间查询会一直挂着，最后抛 `MongooseServerSelectionError`，被路由统一按 500 返回，前端因此只能显示「登录失败，请检查邮箱和密码」，看起来像是密码错了。现在 `middleware/dbGuard.js` 会：

- 连接未就绪时直接返回 503 与明确文案，不再让请求挂到超时；
- 首次连接失败后自动重试（最多 5 次，间隔 3 秒），并打印 `MongoDB connection failed (第 n 次)`；
- 把网络类异常单独映射为 503，前端提示「数据库连接超时」。

若仍频繁出现，优先检查本机到 Atlas 的出口网络：域名能解析不代表 TCP 27017 可达。可在 PowerShell 里执行 `Test-NetConnection <集群节点>:27017`，或在 Atlas 控制台确认 Network Access 的 IP 白名单。

## 语音识别实现要点

1. **换取 token**：`POST https://aip.baidubce.com/oauth/2.0/token`，`grant_type=client_credentials`。返回值缓存到过期前 10 分钟，并发请求复用同一个 Promise，避免重复换取。
2. **调用识别**：`POST https://vop.baidu.com/server_api`，`token/cuid/dev_pid/format/rate/channel` 放在 **URL 参数**，请求体直接发送原始音频字节，`Content-Type: audio/wav;rate=16000`。把参数放进 JSON 体会返回 `3300` 或 `3311`。
3. **音频要求**：WAV/PCM、16000Hz、单声道、60 秒以内。前端已统一转码，直接调用本接口时需自行保证格式。
4. **错误码**：`3301` 音频质量/格式问题、`3302` 鉴权失败、`3305` 音频过长、`3308` 未识别到内容，控制器已映射为中文提示。

## AI 润色与评价实现要点

1. **调用链路**：`POST /api/audio/evaluate` → 两个 `callChatModel()` 请求**并行**执行：一个只做「润色」，一个只做「评价 + 打分」。配置了 `LLM_BASE_URL + LLM_API_KEY + LLM_MODEL` 时走 `POST {LLM_BASE_URL}/chat/completions`（`Authorization: Bearer`）；否则走千帆：`bce-v3` Key 用 `/v2/chat/completions`，应用接入用 access_token（独立缓存）。请求体都是 `{ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }`。
2. **Prompt 设计**：润色请求只带「学生原话 + 润色规则 + 知识点名称」，原始知识点正文仅作专业名词参考并明确禁止照抄——否则模型会把润色写成「照着标准答案重写」。知识点名称作为术语表，用于纠正语音识别造成的同音误识别（如「增伤原理」→「熵增原理」），但规则明确要求只改用字、不改学生结论：学生把原理说成错的定律，也只能改名词，不能顺手把定律编号或定义改成正确答案。评价请求才带完整知识点，只输出 `evaluation / strengths / weaknesses / score`。两段内容都用代码块包起来，避免正文符号破坏指令结构；`temperature` 压到 0.2 让输出更稳定。
3. **JSON 容错**：模型常把结果包进 json 代码块或前后加一句解释，`parseLlmJson()` 会去掉代码围栏、截取第一个 `{` 到最后一个 `}`；解析失败时 `repairJsonText()` 逐字符修复中文模型的常见问题——字符串内未转义的真实换行、`\(` / `\[` 等非法转义、`\frac` / `\text` 这类 LaTeX 反斜杠、对象末尾多余逗号。若仍解析失败，会用「只输出 JSON、不要换行和反斜杠」的追加指令自动重试一次；两次都失败才返回 502 与中文提示。`normalizeFeedback()` 再把 `score` 夹到 0-100 取整、把数组项统一成字符串，`score` 不是数字时同样返回 502，而不是把 0 分写进数据库。
4. **结果落库**：请求带 `knowledgePointId` 时，控制器在调用模型前先校验该知识点存在且属于当前用户（避免白发一次模型请求），评价成功后把 `transcribedText / polishedText / evaluation / strengths / weaknesses / score / createdAt` 整体写入 `KnowledgePoint.lastAttempt`，并按 `score < 60` 更新 `reviewList` 与 `status`。落库失败不会吞掉评价结果，接口仍返回反馈并给出 `saved: null`。详情页直接读 `GET /api/knowledge-points/:id` 里的 `lastAttempt`，不需要再问一次模型。
5. **权限与模型名**：语音技术的权限与大模型权限互相独立。用语音应用凭证调用文心会返回 `error_code: 6 No permission to access data`，需在千帆控制台给应用勾选模型。新版控制台的 `bce-v3` Key 走 `/v2/chat/completions`，模型名与旧版不同（如 `ernie-5.1`、`deepseek-v4-flash-0731`），写错会返回 `invalid_model`；可用 `node scripts/check-llm.js --list` 查看当前 Key 有哪些可用。千帆账户欠费时服务端会返回 `account_overdue`，此时可改用有免费额度的 OpenAI 兼容服务（见上文的 `LLM_*`）。

## AI 出题与智能阅卷实现要点

1. **结构化出题**：`buildQuestionPrompt()` 按题型给两套 JSON 模板。单选题输出 `type / difficulty / question / options(A-D) / answer / explanation`；简答题输出 `answer_key_points`（3-5 条得分点），不要求模型给「标准答案」，避免措辞不同就被判错。`normalizeQuestion()` 会校验题干非空、四个选项齐全且互不相同、答案必须是选项之一，不合格按 `BAD_LLM_JSON` 处理并自动重试一次。
2. **结构化阅卷**：`buildGradePrompt()` 把知识点标题/正文、题目、答案要点、学生回答分别放进独立代码块，要求模型分两步走——先做术语归一化，再按知识点评判，并输出 `{ score, normalizedAnswer, matchedPoints, beyondPoints, issues, explanation }`。这样结果区能分开显示「符合知识点」「正确但知识点未涵盖（不算错）」「需要修正或补充」。`normalizeGrade()` 兼容布尔值和字符串形式的 `true/false`，缺失判分字段时返回 502，而不是默认判错；同时把被误放进 `beyondPoints` 的自我说明（如「作用我不太了解」）改归到 `issues`。
3. **等价术语双保险**：免费小模型执行「先进后出 = 后进先出」这类指令不稳定，因此在送模型前先用 `normalizeEquivalentTerms()` 做确定性替换（先进后出/LIFO → 后进先出，FIFO → 先进先出，setter → 更新函数等），只替换真正同义的词；含义相反的「先进先出」保持原样。
4. **像老师一样打分**：简答题返回 0-100 的整数 `score`，60 分及格，`isCorrect` 由分数换算（避免「40 分却判正确」）。`detectReversedTerm()` 再兜底：知识点讲后进先出、学生却说「先进先出/FIFO」（且不是「不是先进先出」这类否定句）时，强制把分数压到 30 以下并判错，同时在 `issues` 里写明概念说反了。
5. **复用与容错**：出题、阅卷与评价共用 `requestEvaluationJson()`、`sendLlmError()`，因此同样具备去代码围栏、修控制字符/LaTeX 反斜杠、失败重试一次，以及免费模型 429/1305、欠费、Key 无效等中文错误提示。
6. **出题阅卷不写库**：`/api/ai` 下的出题与阅卷是纯模型调用，不经过 `requireDb`；答错后由前端调用 `PUT /api/knowledge-points/:id` 写 `reviewList: true` 与 `status: 'need_review'`，保持职责单一。

## 测评记录接口

作答记录单独存 `QuizAttempt` 集合（`user / knowledgePoint / type / difficulty / question / studentAnswer / isCorrect / score / feedback`），通过 `/api/quiz` 提供读写：

- `POST /api/quiz/attempts`：校验知识点归属后写入一条记录。单选题不信任前端传入的对错，由服务端比较 `studentAnswer` 与 `correctAnswer` 重新判定；简答题保存 `score` 与阅卷返回的 `matchedPoints / beyondPoints / issues / explanation`，并按 `score >= 60` 重新换算 `isCorrect`。题目与作答长度分别限制 2000 / 5000 字，数组最多 8 条。
- `GET /api/quiz/attempts?knowledgePointId=...&limit=50&onlyWrong=true`：按时间倒序返回 `{ attempts, total, wrongCount }`，`onlyWrong=true` 时只返回答错的记录，供复习页筛选。
- 复合索引 `{ user, knowledgePoint, createdAt: -1 }` 保证按知识点翻记录时不用全表扫描。

## RAG 私有知识库（课时10：索引基础设施）

创建 / 更新知识点时，后端会自动把正文「分割 → 向量化 → 存入本地向量库」，为课时11 的检索问答做好准备。实现在 `services/vectorStoreService.js`：

1. **技术选型说明**：课件示例是 LangChain.js + `@langchain/baidu-qianfan` + HNSWLib。本项目按课件「LangChain.js 或原生代码」的许可采用原生实现：旧版千帆 SDK 走 AK/SK 换 token，与项目已迁移的 bce-v3 / OpenAI 兼容凭证不匹配；`hnswlib-node` 是 C++ 原生模块，Windows + 新版 Node 常编译失败。原生实现零新增依赖，接口签名与课件一致。
2. **分割（Split）**：`splitText()` 复刻 RecursiveCharacterTextSplitter 的递归策略——先按段落、再按句子/逗号、最后按字符切，`chunkSize=500`、`chunkOverlap=50`，块间保留重叠保证语义连续；单个知识点最多 60 块，防止超长正文刷爆 Embedding 额度。
3. **嵌入（Embed）**：`embedTexts()` 优先走 `{LLM_BASE_URL}/embeddings`（智谱 `embedding-2`，1024 维），未配 `LLM_*` 时回退千帆 v2 `/v2/embeddings`（`embedding-v1`）。每批最多 16 块，按返回的 `index` 排序对齐。
4. **存储（Store）**：向量库是 `vector_store/store.json`（已 gitignore），每块记录 `userId / knowledgePointId / title / text / embedding`。写入串行化 + 临时文件改名，避免并发覆盖或写坏文件。
5. **自动索引**：`POST /api/knowledge-points` 保存成功后异步调用 `addKnowledgePointToStore()`，不阻塞响应；`PUT` 只在正文变化时重建索引（先删旧块再加新块，比课件 HNSWLib「允许冗余」更干净）；`DELETE` 同步清理向量。索引失败只记日志，不影响知识点保存。
6. **多用户隔离**：检索时按 `userId` 过滤，用户只能问到自己知识库的内容。

### 课时11：检索与生成（RAG 问答闭环）

`POST /api/ai/rag-qa`（`controllers/baiduAiController.js` 的 `answerWithRAG`）把「检索 → 增强 → 生成」串成完整链路：

1. **检索**：`queryVectorStore()` 把问题用同一个 Embedding 模型向量化，在当前用户的向量库里做余弦相似度搜索，取 Top-4；相似度低于 0.35 的块视为不相关直接丢弃。
2. **MCP 结构化 Prompt**：按课件的「大模型上下文协议」用 `<role>` / `<instruction>` / `<context>` / `<question>` 标签划分角色，明确要求「资料里没有就直说不知道，不要编造」。课件的 LCEL `RunnableSequence` 在这里等价实现为「检索 → 拼 Prompt → `callChatModel()`」，从而复用项目已有的多通道路由（智谱 / 千帆 v2 / 千帆 v1）与中文错误提示。
3. **防幻觉双保险**：知识库为空或全部不相关时直接返回「知识库中暂无相关内容」，不发起模型调用；相关时模型也被指令约束只依据资料作答。
4. **引用来源（课件选做优化）**：响应带 `sources` 数组（知识点 id、标题、相似度、片段摘要），前端在回答下方渲染成可点击的 chips，跳转到对应知识点详情页，增加回答可信度。

### 自检

```bash
node scripts/check-rag.js                # 分割 → 向量化 → 入库 → 检索全链路（演示数据自动清理）
node scripts/check-rag.js --stats        # 查看向量库统计
node scripts/check-rag.js --query "问题"  # 对现有向量库做相似度检索
node scripts/check-baidu.js              # 只验证语音密钥能否换到 token
node scripts/check-baidu.js 音频.wav      # 再验证一次识别
node scripts/check-llm.js                # 验证当前配置的大模型能否调通
node scripts/check-llm.js --full         # 跑完整「润色 + 评分」，并校验 JSON 可解析
node scripts/check-llm.js --list         # 列出千帆 Key 可用的对话模型（仅 bce-v3）
node scripts/check-llm.js --model glm-4.7-flash --full   # 临时指定模型名
node scripts/check-xss.js                # 验证入库消毒（代码块保留、恶意标签删除）
node scripts/check-xss.js --db           # 只读扫描数据库，列出仍含原始 HTML 的旧记录```

## 说明

- `.env` 已加入 `.gitignore`，仓库中只保留 `.env.example` 模板。
- 录音仅在内存中中转，不写入磁盘；短语音识别按次计费，调试时注意免费额度。
- 该接口限 60 秒，更长的复述需分段录制或改用实时流式接口。
