# Feynman 学习平台 · 后端

「费曼学习法」知识管理平台的 Node.js 后端：提供用户认证、知识点 CRUD 接口，并作为代理调用百度智能云短语音识别，把前端上传的录音转成文字。

## 技术栈

| 用途 | 选型 |
| --- | --- |
| 运行时 / 框架 | Node.js + Express 5 |
| 数据库 | MongoDB（Mongoose 9，使用 Atlas 云实例） |
| 认证 | jsonwebtoken（JWT，7 天有效）+ bcryptjs |
| 文件上传 | multer 2（memoryStorage，不落盘） |
| 语音识别 | 百度智能云「短语音识别」HTTP 接口（axios 直接调用，未使用 SDK） |

## 目录结构

```
index.js                        入口：加载 .env、连接 MongoDB、挂载路由
routes/users.js                 注册 / 登录
routes/knowledgePoints.js       知识点增删改查（需登录）
routes/audio.js                 录音上传与识别（需登录）
middleware/auth.js              校验请求头 x-auth-token
models/User.js                  用户模型
models/KnowledgePoint.js        知识点模型
controllers/baiduAiController.js  token 获取与缓存、调用百度识别、错误码映射
scripts/check-baidu.js          凭证与接口自检工具
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

百度凭证在控制台「语音技术 → 应用列表」中创建应用后获取，同一页面应同时出现 **AppID、API Key、Secret Key** 三项。注意不要使用「用户中心 → 安全认证」里的 AK/SK，那套无法换取 access_token。

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

## 语音识别实现要点

1. **换取 token**：`POST https://aip.baidubce.com/oauth/2.0/token`，`grant_type=client_credentials`。返回值缓存到过期前 10 分钟，并发请求复用同一个 Promise，避免重复换取。
2. **调用识别**：`POST https://vop.baidu.com/server_api`，`token/cuid/dev_pid/format/rate/channel` 放在 **URL 参数**，请求体直接发送原始音频字节，`Content-Type: audio/wav;rate=16000`。把参数放进 JSON 体会返回 `3300` 或 `3311`。
3. **音频要求**：WAV/PCM、16000Hz、单声道、60 秒以内。前端已统一转码，直接调用本接口时需自行保证格式。
4. **错误码**：`3301` 音频质量/格式问题、`3302` 鉴权失败、`3305` 音频过长、`3308` 未识别到内容，控制器已映射为中文提示。

### 自检

```bash
node scripts/check-baidu.js              # 只验证密钥能否换到 token
node scripts/check-baidu.js 音频.wav      # 再验证一次识别
```

## 说明

- `.env` 已加入 `.gitignore`，仓库中只保留 `.env.example` 模板。
- 录音仅在内存中中转，不写入磁盘；短语音识别按次计费，调试时注意免费额度。
- 该接口限 60 秒，更长的复述需分段录制或改用实时流式接口。
