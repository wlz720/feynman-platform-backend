const axios = require('axios');
const mongoose = require('mongoose');
const KnowledgePoint = require('../models/KnowledgePoint');
const { isDbUnavailable } = require('../middleware/dbGuard');

const TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const ASR_URL = 'https://vop.baidu.com/server_api';

const ASR_ERRORS = {
  3300: '请求参数不合法（cuid/dev_pid 等需要放在 URL 参数里）',
  3301: '音频质量或格式有问题（多见于：实际是 webm/mp3，却声明为 wav）',
  3302: '鉴权失败，access_token 无效或已过期',
  3303: '百度服务端处理失败，请重试',
  3304: '请求超时',
  3305: '音频过长，短语音识别最长 60 秒',
  3307: '音频文件过大',
  3308: '识别结果为空（没说话、静音或音量太小）',
  3310: '音频采样率与声明值不一致',
  3311: '采样率参数不合法（rate 只能是 16000 或 8000，且必须放在 URL 参数里）',
  3312: '音频格式不支持'
};

let cachedToken = '';
let expireAt = 0;
let pendingToken = null;

async function getAccessToken() {
  if (cachedToken && Date.now() < expireAt) return cachedToken;
  if (pendingToken) return pendingToken;

  pendingToken = axios
    .post(TOKEN_URL, null, {
      params: {
        grant_type: 'client_credentials',
        client_id: process.env.BAIDU_API_KEY,
        client_secret: process.env.BAIDU_SECRET_KEY
      },
      timeout: 10000
    })
    .then(({ data }) => {
      if (!data.access_token) {
        const err = new Error('百度 access_token 获取失败');
        err.detail = data;
        throw err;
      }
      cachedToken = data.access_token;
      expireAt = Date.now() + (data.expires_in - 600) * 1000;
      return cachedToken;
    })
    .finally(() => {
      pendingToken = null;
    });

  return pendingToken;
}

exports.transcribeAudio = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ msg: '没有接收到音频文件' });
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (err) {
    const detail = err.detail || {};
    console.error('获取百度 token 失败：', detail.error || err.message);
    return res.status(502).json({
      msg: '获取百度 access_token 失败，请检查 API Key / Secret Key',
      error: {
        error: detail.error,
        error_description: detail.error_description
      }
    });
  }

  try {
    // 该接口只认「URL 传参 + 原始音频 body」；把 rate 放 JSON body 会返回 3311
    const { data } = await axios.post(ASR_URL, req.file.buffer, {
      params: {
        token,
        cuid: String(req.user?.id || 'feynman-platform'),
        dev_pid: 1537,
        format: 'wav',
        rate: 16000,
        channel: 1
      },
      headers: { 'Content-Type': 'audio/wav;rate=16000' },
      timeout: 30000
    });

    if (data.err_no === 0) {
      const text = (data.result || []).join('').trim();
      if (!text) {
        return res.status(422).json({ msg: '没有识别到语音内容，请靠近麦克风重试' });
      }
      return res.json({ result: text });
    }

    console.error('百度识别失败：', data);
    return res.status(502).json({
      msg: ASR_ERRORS[data.err_no] || '百度语音识别失败',
      error: data
    });
  } catch (err) {
    console.error('调用百度识别接口异常：', err.response?.data || err.message);
    return res.status(502).json({ msg: '调用百度语音识别接口失败' });
  }
};

exports.getAccessToken = getAccessToken;

// ==================== 千帆大模型：文本润色 + 智能评价 ====================

const QIANFAN_TOKEN_URL = 'https://aip.baidubce.com/oauth/2.0/token';
const QIANFAN_V1_CHAT_BASE = 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat';
const QIANFAN_V2_CHAT_URL = 'https://qianfan.baidubce.com/v2/chat/completions';

// 低于该分数视为没掌握，自动进入复习列表
const REVIEW_THRESHOLD = 60;
const MAX_INPUT_CHARS = 10000;

let qianfanToken = '';
let qianfanExpireAt = 0;
let pendingQianfanToken = null;

// 千帆新版控制台发的是 bce-v3/ALTAK-xxx（Bearer 鉴权），
// 旧版「应用接入」发的才是 API Key + Secret Key（换 access_token）。
// 未单独配置 QIANFAN_* 时回退到语音那套凭证，对应课件里「凭证可能相同」的情况。
function resolveQianfanCredential() {
  const apiKey = process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY;
  const secretKey = process.env.QIANFAN_SECRET_KEY || process.env.BAIDU_SECRET_KEY;
  return { apiKey, secretKey, useBearer: Boolean(apiKey && apiKey.startsWith('bce-v3/')) };
}

async function getQianfanAccessToken() {
  if (qianfanToken && Date.now() < qianfanExpireAt) return qianfanToken;
  if (pendingQianfanToken) return pendingQianfanToken;

  const { apiKey, secretKey } = resolveQianfanCredential();
  if (!apiKey || !secretKey) {
    const err = new Error('未配置千帆凭证（QIANFAN_API_KEY / QIANFAN_SECRET_KEY）');
    err.code = 'NO_CREDENTIAL';
    throw err;
  }

  pendingQianfanToken = axios
    .post(QIANFAN_TOKEN_URL, null, {
      params: {
        grant_type: 'client_credentials',
        client_id: apiKey,
        client_secret: secretKey
      },
      timeout: 10000
    })
    .then(({ data }) => {
      if (!data.access_token) {
        const err = new Error('千帆 access_token 获取失败');
        err.detail = data;
        throw err;
      }
      qianfanToken = data.access_token;
      qianfanExpireAt = Date.now() + (data.expires_in - 600) * 1000;
      return qianfanToken;
    })
    .finally(() => {
      pendingQianfanToken = null;
    });

  return pendingQianfanToken;
}

function buildEvaluatePrompt(originalContent, transcribedText) {
  return `你是一个严格而友善的计算机科学学习教练。你的任务是评估学生对一个知识点的复述，并给出反馈。

【原始知识点】:
\`\`\`
${originalContent}
\`\`\`

【学生的口头复述文本】:
\`\`\`
${transcribedText}
\`\`\`

请你完成以下三项任务:
1. **文本润色**: 将学生的复述文本润色成一段通顺、专业、书面化的文字。修正明显的语法错误和口语化表达，但保持其核心观点不变。
2. **综合评价**: 基于原始知识点，对学生的复述进行评价。指出其优点和可以改进的地方。
3. **评分**: 综合考虑准确性、完整性、逻辑性和流畅性，给出一个0到100的整数分数。

请严格按照以下JSON格式返回你的结果，不要包含任何额外的解释或文字。
各字段用纯中文文本填写：不要使用 LaTeX 或反斜杠转义，字符串内部不要出现真实换行（需要分行请用中文逗号或分号）。
{
  "polishedText": "这里是润色后的文本",
  "evaluation": "这里是你的综合评价",
  "strengths": ["优点1", "优点2"],
  "weaknesses": ["可以改进的地方1", "可以改进的地方2"],
  "score": 85
}`;
}

// 模型经常把 JSON 包在 ```json 代码块里，或前后带一句解释，这里做容错提取。
// 中文模型还常犯两类错：字符串里直接换行（未转义控制字符）、把反斜杠写进正文（非法转义），
// 所以先逐字符修复再交给 JSON.parse，修不好再交给上层重试。
function repairJsonText(text) {
  let out = '';
  let inString = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }

    if (ch === '"') {
      out += ch;
      inString = false;
      continue;
    }

    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined) {
        out += '\\\\';
        continue;
      }
      if (next === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += `\\u${hex}`;
          i += 5;
        } else {
          out += '\\\\';
        }
        continue;
      }
      // \frac、\text、\theta 这类是模型写公式时的 LaTeX，按普通文本保留反斜杠
      if (/[a-zA-Z]/.test(next) && /[a-zA-Z]/.test(text[i + 2] || '')) {
        out += '\\\\';
        continue;
      }
      // \( \) \[ \] 是模型写公式时的高频产物，去掉反斜杠即可
      if ('()[]'.includes(next)) {
        out += next;
        i += 1;
        continue;
      }
      if ('"\\/bfnrt'.includes(next)) {
        out += `\\${next}`;
        i += 1;
        continue;
      }
      // 其余（\frac、\text 之类）一律转义成普通反斜杠
      out += '\\\\';
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }

    out += ch;
  }

  // 去掉对象/数组末尾多余的逗号
  return out.replace(/,\s*([}\]])/g, '$1');
}

function parseLlmJson(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('模型返回内容为空');
    err.code = 'BAD_LLM_JSON';
    throw err;
  }
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    const err = new Error('模型返回内容不是 JSON');
    err.code = 'BAD_LLM_JSON';
    throw err;
  }

  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (firstErr) {
    try {
      return JSON.parse(repairJsonText(candidate));
    } catch {
      const err = new Error(`模型返回的 JSON 无法解析：${firstErr.message}`);
      err.code = 'BAD_LLM_JSON';
      throw err;
    }
  }
}

function normalizeFeedback(obj) {
  const toList = (v) => (Array.isArray(v) ? v.map((i) => String(i).trim()).filter(Boolean) : []);
  const score = Number(obj.score);
  if (!Number.isFinite(score)) {
    throw new Error('模型返回的 score 不是数字');
  }
  return {
    polishedText: String(obj.polishedText || '').trim(),
    evaluation: String(obj.evaluation || '').trim(),
    strengths: toList(obj.strengths),
    weaknesses: toList(obj.weaknesses),
    score: Math.max(0, Math.min(100, Math.round(score)))
  };
}

const LLM_ERROR_HINTS = {
  6: '千帆应用没有该模型权限，请在千帆控制台的「应用接入 → 模型服务」里勾选文心模型后重试',
  invalid_model: '模型名不可用或当前 Key 没有该模型权限，可执行 node scripts/check-llm.js --list 查看可用模型',
  model_not_found: '模型名不存在，请检查 .env 里的 LLM_MODEL',
  account_overdue: '账户已欠费或被限制，请到服务商控制台充值或领取免费额度后再试',
  access_denied: '该 Key 没有访问权限，请检查控制台里的模型权限配置',
  invalid_api_key: 'API Key 无效或已过期，请检查 .env 里的 LLM_API_KEY',
  insufficient_quota: '免费额度已用完或账户余额不足，请更换 Key 或充值',
  insufficient_balance: '账户余额不足，请充值后重试',
  rate_limit_exceeded: '请求过于频繁，请稍后重试',
  1305: '免费模型当前访问量过大（智谱 1305），请稍后重试或改用 glm-4-flash',
  110: '千帆 access_token 无效，请检查 api_key / secret_key 是否属于同一个应用',
  111: '千帆 access_token 已过期，请重新获取',
  17: '千帆接口调用量已达每日上限',
  18: '千帆接口并发超限，请稍后重试',
  336501: '千帆账户额度不足',
  336502: '千帆请求过于频繁，请稍后重试'
};

// 通用 OpenAI 兼容接口（智谱、硅基流动、通义、DeepSeek 等都用这个协议），
// 配了 LLM_BASE_URL + LLM_API_KEY 就优先走这里，不再依赖千帆。
function resolveGenericLlm() {
  const baseUrl = (process.env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.LLM_API_KEY || '').trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey, model: (process.env.LLM_MODEL || '').trim() };
}

async function callOpenAiCompatible({ baseUrl, apiKey, model }, prompt) {
  if (!model) {
    const err = new Error('未配置 LLM_MODEL（例如 glm-4.7-flash）');
    err.code = 'NO_CREDENTIAL';
    throw err;
  }
  const { data } = await axios.post(
    `${baseUrl}/chat/completions`,
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000
    }
  );
  if (data.error) {
    const err = new Error(data.error.message || '模型接口返回错误');
    err.llm = data.error;
    throw err;
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('模型没有返回内容');
  }
  return content;
}

async function callChatModel(prompt) {
  const generic = resolveGenericLlm();
  if (generic) {
    return callOpenAiCompatible(generic, prompt);
  }

  const { apiKey, useBearer } = resolveQianfanCredential();
  if (!apiKey) {
    const err = new Error('未配置大模型凭证：请设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL，或配置千帆 QIANFAN_*');
    err.code = 'NO_CREDENTIAL';
    throw err;
  }

  if (useBearer) {
    const { data } = await axios.post(
      QIANFAN_V2_CHAT_URL,
      {
        model: process.env.QIANFAN_MODEL || 'ernie-5.1',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 60000
      }
    );
    if (data.error_code) {
      const err = new Error(data.error_msg || '千帆接口返回错误');
      err.qianfan = data;
      throw err;
    }
    return data.choices?.[0]?.message?.content;
  }

  const token = await getQianfanAccessToken();
  const model = process.env.QIANFAN_MODEL || 'eb-instant';
  const { data } = await axios.post(
    `${QIANFAN_V1_CHAT_BASE}/${model}`,
    {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2
    },
    { params: { access_token: token }, timeout: 60000 }
  );
  if (data.error_code) {
    const err = new Error(data.error_msg || '千帆接口返回错误');
    err.qianfan = data;
    throw err;
  }
  return data.result;
}

exports.evaluateFeynmanAttempt = async (req, res) => {
  const { originalContent, transcribedText, knowledgePointId } = req.body || {};

  if (!originalContent || !transcribedText) {
    return res.status(400).json({ msg: '缺少 originalContent 或 transcribedText' });
  }
  if (typeof originalContent !== 'string' || typeof transcribedText !== 'string') {
    return res.status(400).json({ msg: 'originalContent 与 transcribedText 必须是字符串' });
  }
  if (originalContent.length + transcribedText.length > MAX_INPUT_CHARS) {
    return res.status(400).json({ msg: `内容过长，请控制在 ${MAX_INPUT_CHARS} 字以内` });
  }
  if (!transcribedText.trim()) {
    return res.status(400).json({ msg: '复述文本为空，无法评价' });
  }

  try {
    // 带 knowledgePointId 时，评价结果会顺手写回该知识点（详情页据此展示上次复述）
    let targetKp = null;
    if (knowledgePointId) {
      if (!mongoose.Types.ObjectId.isValid(knowledgePointId)) {
        return res.status(400).json({ msg: 'knowledgePointId 不合法' });
      }
      targetKp = await KnowledgePoint.findById(knowledgePointId);
      if (!targetKp) {
        return res.status(404).json({ msg: '知识点不存在' });
      }
      if (targetKp.user?.toString() !== req.user?.id) {
        return res.status(403).json({ msg: '无权评价该知识点' });
      }
    }

    const prompt = buildEvaluatePrompt(originalContent, transcribedText);
    let feedback = null;
    let lastJsonError = null;
    for (let attempt = 0; attempt < 2 && !feedback; attempt += 1) {
      const raw = await callChatModel(
        attempt === 0
          ? prompt
          : `${prompt}\n\n上一次返回的内容不是合法 JSON。请重新输出，只输出一个 JSON 对象，不要代码块、不要解释，字符串内不要有换行和反斜杠。`
      );
      try {
        feedback = normalizeFeedback(parseLlmJson(raw));
      } catch (parseErr) {
        lastJsonError = parseErr;
        console.error(`模型返回内容解析失败（第 ${attempt + 1} 次）：`, parseErr.message);
      }
    }
    if (!feedback) {
      const err = new Error(lastJsonError?.message || '模型返回内容无法解析');
      err.code = 'BAD_LLM_JSON';
      throw err;
    }

    let saved = null;
    if (targetKp) {
      try {
        targetKp.lastAttempt = {
          ...feedback,
          transcribedText: transcribedText.trim(),
          createdAt: new Date()
        };
        const needReview = feedback.score < REVIEW_THRESHOLD;
        targetKp.reviewList = needReview;
        targetKp.status = needReview ? 'need_review' : 'mastered';
        await targetKp.save();
        saved = { reviewList: targetKp.reviewList, status: targetKp.status };
      } catch (saveErr) {
        // 保存失败不影响把评价结果返回给用户
        console.error('保存评价结果失败：', saveErr.message);
      }
    }

    return res.json({ ...feedback, saved });
  } catch (err) {
    const detail = err.qianfan || err.detail || {};

    if (isDbUnavailable(err)) {
      return res.status(503).json({ msg: '数据库连接超时，请稍后重试' });
    }
    if (err.code === 'NO_CREDENTIAL') {
      return res.status(503).json({ msg: err.message + '，请在 .env 中配置后重启后端' });
    }
    if (err.code === 'BAD_LLM_JSON') {
      return res.status(502).json({ msg: 'AI 返回的内容格式异常，已自动重试仍未成功，请再点一次评分' });
    }
    if (err.llm) {
      // 通用 OpenAI 兼容接口在 200 里返回 error
      console.error('模型接口返回错误：', err.llm);
      return res.status(502).json({
        msg: LLM_ERROR_HINTS[err.llm.code] || `模型接口返回错误：${err.llm.message || err.llm.code}`,
        error: { error_code: err.llm.code, error_msg: err.llm.message }
      });
    }
    if (err.code === 'ERR_BAD_RESPONSE' || err.response?.status) {
      const status = err.response?.status;
      const body = err.response?.data || {};
      // 千帆 v1 用 error_code/error_msg，v2 与 OpenAI 兼容接口用 error.code/error.message
      const upstreamCode = body.error_code || body.error?.code;
      const upstreamMsg = body.error_msg || body.error?.message;
      console.error('模型接口异常：', status, body);
      return res.status(502).json({
        msg:
          LLM_ERROR_HINTS[upstreamCode] ||
          `调用大模型失败（HTTP ${status}）${upstreamMsg ? '：' + upstreamMsg : ''}`,
        error: { error_code: upstreamCode, error_msg: upstreamMsg }
      });
    }
    if (detail.error_code) {
      console.error('千帆返回错误：', detail.error_code, detail.error_msg);
      return res.status(502).json({
        msg: LLM_ERROR_HINTS[detail.error_code] || `千帆返回错误：${detail.error_msg || detail.error_code}`,
        error: { error_code: detail.error_code, error_msg: detail.error_msg }
      });
    }
    if (detail.error) {
      console.error('千帆鉴权失败：', detail.error, detail.error_description);
      return res.status(503).json({
        msg: `千帆鉴权失败（${detail.error}），请检查 QIANFAN_API_KEY / QIANFAN_SECRET_KEY`,
        error: { error: detail.error, error_description: detail.error_description }
      });
    }

    console.error('AI 评价失败：', err.message);
    return res.status(502).json({ msg: `AI 评价失败：${err.message}` });
  }
};
