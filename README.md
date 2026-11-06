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
scripts/check-baidu.js          语音凭证与识别自检
scripts/check-llm.js            大模型凭证、模型权限与完整评价链路自检
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

1. **调用链路**：`POST /api/audio/evaluate` → `callChatModel()`。配置了 `LLM_BASE_URL + LLM_API_KEY + LLM_MODEL` 时走 `POST {LLM_BASE_URL}/chat/completions`（`Authorization: Bearer`）；否则走千帆：`bce-v3` Key 用 `/v2/chat/completions`，应用接入用 access_token（独立缓存）。请求体都是 `{ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }`。
2. **Prompt 设计**：单个 user 消息里同时给出「角色设定 + 原始知识点 + 学生复述 + 三项任务 + JSON 字段模板」，把 `originalContent` 与 `transcribedText` 用代码块包起来，避免内容里的符号破坏指令结构。`temperature` 压到 0.2 是为了让输出更稳定。
3. **JSON 容错**：模型常把结果包进 json 代码块或前后加一句解释，`parseLlmJson()` 会去掉代码围栏、截取第一个 `{` 到最后一个 `}`；解析失败时 `repairJsonText()` 逐字符修复中文模型的常见问题——字符串内未转义的真实换行、`\(` / `\[` 等非法转义、`\frac` / `\text` 这类 LaTeX 反斜杠、对象末尾多余逗号。若仍解析失败，会用「只输出 JSON、不要换行和反斜杠」的追加指令自动重试一次；两次都失败才返回 502 与中文提示。`normalizeFeedback()` 再把 `score` 夹到 0-100 取整、把数组项统一成字符串，`score` 不是数字时同样返回 502，而不是把 0 分写进数据库。
4. **结果落库**：请求带 `knowledgePointId` 时，控制器在调用模型前先校验该知识点存在且属于当前用户（避免白发一次模型请求），评价成功后把 `transcribedText / polishedText / evaluation / strengths / weaknesses / score / createdAt` 整体写入 `KnowledgePoint.lastAttempt`，并按 `score < 60` 更新 `reviewList` 与 `status`。落库失败不会吞掉评价结果，接口仍返回反馈并给出 `saved: null`。详情页直接读 `GET /api/knowledge-points/:id` 里的 `lastAttempt`，不需要再问一次模型。
5. **权限与模型名**：语音技术的权限与大模型权限互相独立。用语音应用凭证调用文心会返回 `error_code: 6 No permission to access data`，需在千帆控制台给应用勾选模型。新版控制台的 `bce-v3` Key 走 `/v2/chat/completions`，模型名与旧版不同（如 `ernie-5.1`、`deepseek-v4-flash-0731`），写错会返回 `invalid_model`；可用 `node scripts/check-llm.js --list` 查看当前 Key 有哪些可用。千帆账户欠费时服务端会返回 `account_overdue`，此时可改用有免费额度的 OpenAI 兼容服务（见上文的 `LLM_*`）。

### 自检

```bash
node scripts/check-baidu.js              # 只验证语音密钥能否换到 token
node scripts/check-baidu.js 音频.wav      # 再验证一次识别
node scripts/check-llm.js                # 验证当前配置的大模型能否调通
node scripts/check-llm.js --full         # 跑完整「润色 + 评分」，并校验 JSON 可解析
node scripts/check-llm.js --list         # 列出千帆 Key 可用的对话模型（仅 bce-v3）
node scripts/check-llm.js --model glm-4.7-flash --full   # 临时指定模型名```

## 说明

- `.env` 已加入 `.gitignore`，仓库中只保留 `.env.example` 模板。
- 录音仅在内存中中转，不写入磁盘；短语音识别按次计费，调试时注意免费额度。
- 该接口限 60 秒，更长的复述需分段录制或改用实时流式接口。
