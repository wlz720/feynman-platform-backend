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

// 润色单独走一次请求。为了让模型能把同音误识别的专有名词改回来
// （如「增伤原理」→「熵增原理」），这里会带上知识点名称作术语表，
// 但不带正文的定义和结论，避免它照着标准答案重写学生的话。
function buildPolishPrompt(transcribedText, originalContent, kpTitle) {
  const titleLine = kpTitle ? `【知识点名称（术语表，只用于校对用字）】：${kpTitle}\n\n` : '';
  return `你是中文语音转写校对员。请只对学生口述的文本做“语言润色”，不要回答问题、不要讲解知识。

${titleLine}【学生口述（语音识别结果）】
\`\`\`
${transcribedText}
\`\`\`

润色规则（严格遵守）：
1. 只改表达，不改意思：去掉口头禅和重复词，补标点，理顺语序。
2. 必须纠正专有名词的同音/近音误识别。重点检查学生口述里与${kpTitle ? '【知识点名称】' : '【原始知识点】中的术语'}读音相近但用字错误的词，改回正确写法（例如「增伤原理」「增长原理」→「熵增原理」，「拉格郎日」→「拉格朗日」）。只替换这几个字，紧挨着的其他字一律不动。
3. 只纠用字，不纠知识。学生说错、说漏、说得不完整，甚至把概念安到错误的理论上，都要原样保留。例如学生说「增伤原理就是热力学第一定律吧」，只能改成「熵增原理就是热力学第一定律吧」，「第一定律」不许改成「第二定律」，哪怕它在事实上是错的。
4. 其他明显的同音错字（如「因该」→「应该」）也可以改，但拿不准时保留原样。
5. 不要改写成定义句。不要新增「即……」「是指……」这类学生原话里没有的解释性结构，也不要补全主语、宾语或结论。
6. 禁止引入【原始知识点】里的定义、结论或表述；禁止添加学生没说过的新信息。术语替换不算添加信息，但不能因为换了术语就顺手把知识点里的解释也写进来。
7. 润色后的长度应当和原话接近，最多略长；如果会明显变长，说明你在补充知识，请停下重写。

【原始知识点（仅供判断专业名词用，禁止照抄）】
\`\`\`
${originalContent}
\`\`\`

只输出润色后的这一段文字，不要加引号、不要解释、不要 JSON。`;
}

function cleanPolishedText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/```$/, '')
    .replace(/^(润色后(的文本|结果)?|润色版|修改后)[：:]\s*/u, '')
    .replace(/^["“「](.*)["”」]$/s, '$1')
    .trim();
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
1. **综合评价**: 基于原始知识点，对学生的复述进行评价。指出其优点和可以改进的地方。如果复述与知识点无关或明显错误，要直接指出。
2. **优点**: 列出学生做得好的地方；确实没有优点时返回空数组。
3. **评分**: 综合考虑准确性、完整性、逻辑性和流畅性，给出一个0到100的整数分数。

注意：本次不要润色学生文本，润色由另一个环节单独完成，你只负责评价和打分。

请严格按照以下JSON格式返回你的结果，不要包含任何额外的解释或文字。
各字段用纯中文文本填写：不要使用 LaTeX 或反斜杠转义，字符串内部不要出现真实换行（需要分行请用中文逗号或分号）。
{
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

async function requestEvaluationJson(prompt) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await callChatModel(
      attempt === 0
        ? prompt
        : `${prompt}\n\n上一次返回的内容不是合法 JSON。请重新输出，只输出一个 JSON 对象，不要代码块、不要解释，字符串内不要有换行和反斜杠。`
    );
    try {
      return parseLlmJson(raw);
    } catch (parseErr) {
      lastErr = parseErr;
      console.error(`模型返回内容解析失败（第 ${attempt + 1} 次）：`, parseErr.message);
    }
  }
  const err = new Error(lastErr?.message || '模型返回内容无法解析');
  err.code = 'BAD_LLM_JSON';
  throw err;
}

// 各 AI 接口的异常映射集中在这里，避免出题/评分/评价三处各写一份
function sendLlmError(res, err, label, retryLabel) {
  const detail = err.qianfan || err.detail || {};

  if (isDbUnavailable(err)) {
    return res.status(503).json({ msg: '数据库连接超时，请稍后重试' });
  }
  if (err.code === 'NO_CREDENTIAL') {
    return res.status(503).json({ msg: err.message + '，请在 .env 中配置后重启后端' });
  }
  if (err.code === 'BAD_LLM_JSON') {
    return res.status(502).json({
      msg: `AI 返回的内容格式异常，已自动重试仍未成功，请再点一次${retryLabel || label}`
    });
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

  console.error(`AI ${label}失败：`, err.message);
  return res.status(502).json({ msg: `AI ${label}失败：${err.message}` });
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

    // 润色与评价各走一次请求、并行执行：润色只看学生原话，评价才带知识点，
    // 这样模型不会把「润色」做成「照着标准答案重写」。
    const [polishedRaw, evalObj] = await Promise.all([
      callChatModel(buildPolishPrompt(transcribedText, originalContent, targetKp?.title)).catch((polishErr) => {
        console.error('润色请求失败，回退使用原文本：', polishErr.message);
        return '';
      }),
      requestEvaluationJson(buildEvaluatePrompt(originalContent, transcribedText))
    ]);
    const polishedText = cleanPolishedText(polishedRaw) || transcribedText.trim();
    const feedback = normalizeFeedback({ ...evalObj, polishedText });

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
    return sendLlmError(res, err, '评价', '评分');
  }
};

// ==================== 第九课：AI 出题 + 智能阅卷 ====================

const QUIZ_DIFFICULTIES = ['基础', '中等', '困难'];
const QUIZ_TYPES = ['single-choice', 'short-answer'];
const MAX_QUESTION_CHARS = 2000;
const MAX_ANSWER_CHARS = 5000;

function buildQuestionPrompt(content, difficulty, type) {
  const isChoice = type === 'single-choice';
  const schema = isChoice
    ? `{
  "type": "single-choice",
  "difficulty": "${difficulty}",
  "question": "这里是题干",
  "options": {
    "A": "选项A的内容",
    "B": "选项B的内容",
    "C": "选项C的内容",
    "D": "选项D的内容"
  },
  "answer": "C",
  "explanation": "这里是对正确答案的简短解释"
}`
    : `{
  "type": "short-answer",
  "difficulty": "${difficulty}",
  "question": "这里是题干",
  "answer_key_points": ["答案要点1", "答案要点2", "答案要点3"],
  "explanation": "这里是对参考答案的简短解释"
}`;

  return `你是一个专业的计算机科学出题专家。请根据【知识点内容】和【指定难度】生成一道${isChoice ? '单项选择' : '简答'}题。

【知识点内容】:
"""
${content}
"""

【指定难度】: ${difficulty}（基础=概念记忆，中等=理解与应用，困难=分析或综合）

出题要求：
1. 题目必须能直接用【知识点内容】回答，不要引入该知识点之外的知识。
2. ${isChoice ? '给出 A/B/C/D 四个互不相同的选项，有且只有一个正确，干扰项要合理。' : '题干要求用自己的话阐述，答案要点 3-5 条，覆盖得分点。'}
3. 题干简洁清晰，不要照抄知识点里的整段原文。
4. 难度必须符合【指定难度】。

请严格按照以下 JSON 格式返回题目，不要包含任何额外的解释或文字，确保所有字段都存在。
${schema}

只输出 JSON。`;
}

function normalizeQuestion(obj, difficulty, type) {
  const fail = (msg) => {
    const err = new Error(msg);
    err.code = 'BAD_LLM_JSON';
    throw err;
  };
  const question = String(obj?.question || '').trim();
  if (!question) fail('题目缺少题干');

  if (type === 'single-choice') {
    const rawOptions = obj.options && typeof obj.options === 'object' ? obj.options : {};
    const options = {};
    ['A', 'B', 'C', 'D'].forEach((key) => {
      const value = rawOptions[key];
      if (typeof value === 'string' && value.trim()) options[key] = value.trim();
    });
    if (Object.keys(options).length < 4) fail('选择题选项不足 A/B/C/D');

    const answer = String(obj.answer || '').trim().toUpperCase().charAt(0);
    if (!options[answer]) fail('选择题答案不是 A/B/C/D 之一');

    return {
      type,
      difficulty,
      question,
      options,
      answer,
      explanation: String(obj.explanation || '').trim()
    };
  }

  const rawPoints = Array.isArray(obj.answer_key_points) ? obj.answer_key_points : obj.answerKeyPoints;
  const answerKeyPoints = (Array.isArray(rawPoints) ? rawPoints : [])
    .map((item) => String(item).trim())
    .filter(Boolean);
  if (!answerKeyPoints.length) fail('简答题缺少答案要点');

  return {
    type,
    difficulty,
    question,
    answerKeyPoints,
    explanation: String(obj.explanation || '').trim()
  };
}

exports.generateQuestion = async (req, res) => {
  const body = req.body || {};
  const content = typeof body.knowledgePointContent === 'string' ? body.knowledgePointContent.trim() : '';
  const difficulty = body.difficulty;
  const type = body.type || 'single-choice';

  if (!content) return res.status(400).json({ msg: '缺少知识点内容，无法出题' });
  if (content.length > MAX_INPUT_CHARS) {
    return res.status(400).json({ msg: `知识点内容过长，请控制在 ${MAX_INPUT_CHARS} 字以内` });
  }
  if (!QUIZ_DIFFICULTIES.includes(difficulty)) {
    return res.status(400).json({ msg: '难度只能是：基础、中等、困难' });
  }
  if (!QUIZ_TYPES.includes(type)) {
    return res.status(400).json({ msg: '题型只能是：single-choice、short-answer' });
  }

  try {
    const raw = await requestEvaluationJson(buildQuestionPrompt(content, difficulty, type));
    return res.json(normalizeQuestion(raw, difficulty, type));
  } catch (err) {
    return sendLlmError(res, err, '出题', '生成题目');
  }
};



// 免费小模型对「等价术语」的指令执行不稳定，会机械地判「先进后出」与「后进先出」矛盾。
// 送模型前先把这类同义写法统一，只做语义等价替换；含义相反的词（先进先出）不受影响。
const TERM_EQUIVALENTS = [
  [/先进后出/g, '后进先出'],
  [/\bLIFO\b/gi, '后进先出'],
  [/\bFIFO\b/gi, '先进先出'],
  [/\bset\s*函数\b/gi, '更新函数'],
  [/\bsetter\b/gi, '更新函数'],
  [/状态变量/g, '状态值']
];

function normalizeEquivalentTerms(text) {
  return TERM_EQUIVALENTS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    String(text || '')
  );
}

function buildGradePrompt(question, answerKeyPoints, studentAnswer, knowledgePoint = {}) {
  const kpBlock = knowledgePoint.content
    ? `【知识点标题】: ${knowledgePoint.title || '（未提供）'}

【知识点内容】:
"""
${knowledgePoint.content}
"""

`
    : '';

  return `你是一个客观、懂学科知识的计算机科学阅卷老师。请依据学生的学习资料判断回答，而不是只比对措辞。

【最重要的规则】中文技术术语常有多种等价说法，必须先统一术语，再判断对错：
- 「先进后出」=「后进先出」= LIFO，三者完全等价，绝不能说它们矛盾；
- 「先进先出」= FIFO，这是另一个特性，与上面含义相反；
- 注意只差一个字：「先进后出」≠「先进先出」。学生说「先进先出」就是错的，不能套用等价规则；
- 「状态值」=「状态变量」，「更新函数」=「setter」=「set 函数」。
等价替换只适用于真正同义的词，不能把含义相反的词也说成等价。

${kpBlock}【题目】:
"""
${question}
"""

【答案要点（由另一个模型生成，仅供参考，可能不完整）】:
${answerKeyPoints.map((point, index) => `${index + 1}. ${point}`).join('\n')}

【学生的回答】:
"""
${studentAnswer}
"""

请按以下两步作答，不要跳步：
第一步：把【学生的回答】里真正同义的表述替换成标准术语，得到 normalizedAnswer。只改用词，不改结论，不补全知识；「先进先出」与「后进先出」含义相反，绝不能改写成彼此。
第二步：以 normalizedAnswer 和【知识点内容】为依据完成评判。

评判要求：
1. 以【知识点内容】为主要依据，答案要点只作辅助。知识点里写到、但要点没列出的内容同样算符合。
2. 归一化后「栈是先进后出」会变成「栈是后进先出」，必须判为与知识点一致；但如果学生原本说的是「先进先出」，归一化后仍是「先进先出」，必须判错。
3. 只有【知识点内容】里确实出现或可由其直接推出的内容，才能写入 matchedPoints，并说清楚哪句话符合哪个知识点；知识点没写的内容即使正确也不能放这里。学生用口语重述知识点里已有的内容（例如「栈顶随时能取到最上面那个元素」对应「取栈顶元素 peek」）应归入 matchedPoints，不要因为措辞不同就放进 beyondPoints。
4. beyondPoints 只放「学生额外说出的、正确的、与知识点相关的知识」。像「作用我不太了解」「我忘了」这类自我说明不是拓展，也不属于符合知识点，必须写入 issues。
5. 与知识点矛盾、明显错误，或题目要求的关键点缺失，写入 issues；没有则返回空数组。
6. 像老师阅卷一样打 0-100 的分数 score：先按答案要点分配大致权重；答到且与知识点一致就得分，说反或与知识点矛盾要扣分，没提到不得分；beyondPoints 是正确拓展，不加分也不扣分；表达是否口语化不影响分数。
7. 分数档位：完全正确且覆盖全部要点 85-100；覆盖主要要点 70-84；只覆盖部分要点 60-69；只有零散正确信息或存在明显矛盾 1-59；完全错误或空泛 0。分数取整数，不要给 59.5 这种小数。
8. 如果把知识点里的核心特性说成相反的说法（例如知识点是「后进先出」，学生说成「先进先出」或 FIFO），该要点不给分，且整题总分不得高于 30。
9. 不要臆造知识点里没有的结论；拿不准时，以 normalizedAnswer 与知识点的字面含义是否冲突为准。
10. 各数组最多 4 条、每条一句话，要具体到内容，不要写「回答较好」这类空话。
11. explanation 用中文总结得分理由，指出符合与需要修正之处，不超过 100 字。

请严格按照以下 JSON 格式返回，不要包含任何额外的解释或文字。字符串内不要有换行和反斜杠。
{
  "score": 82,
  "normalizedAnswer": "统一术语后的学生回答",
  "matchedPoints": ["符合知识点的具体内容"],
  "beyondPoints": ["回答正确但知识点未涵盖、且与知识点相关的内容"],
  "issues": ["与知识点矛盾、错误或缺失的关键点"],
  "explanation": "这里是打分理由"
}

只输出 JSON。`;
}

// 小模型偶尔忽略「先进先出 ≠ 后进先出」，这里做一次确定性反义检测：
// 知识点讲后进先出、学生却说先进先出（且不是「不是先进先出」这类否定句）时强制降分。
const REVERSED_TERM = /先进先出|FIFO/i;
function detectReversedTerm(answerText, kpContent) {
  if (!/后进先出|LIFO/i.test(kpContent)) return false;
  return String(answerText)
    .split(/[。；;！!？?\n，,]/)
    .some((clause) => REVERSED_TERM.test(clause) && !/(不是|并非|而非|而不是|不等于)/.test(clause));
}

function normalizeGrade(obj, studentAnswer = '') {
  // 新契约只让模型给分数，及格线以下统一判错，避免「分数 40 却说回答正确」的自相矛盾
  const rawScore =
    typeof obj?.score === 'number' ? obj.score : Number(String(obj?.score ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(rawScore)) {
    const err = new Error('阅卷结果缺少 score');
    err.code = 'BAD_LLM_JSON';
    throw err;
  }
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const isCorrect = score >= 60;
  const toList = (value) =>
    (Array.isArray(value) ? value : [])
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 4);

  // 小模型有时把「作用我不太了解」这类自我说明当成拓展知识，这里统一归到 issues
  const SELF_ADMISSION =
    /(不太了解|不是很了解|了解不多|不了解|不知道|不清楚|不太懂|不懂|没学过|没接触过|忘了|忘记了|记不清|不记得|没掌握|不会)/;
  const matchedPoints = toList(obj.matchedPoints);
  const beyondPoints = [];
  const issues = toList(obj.issues);
  for (const item of toList(obj.beyondPoints)) {
    if (SELF_ADMISSION.test(item)) issues.push(`未掌握：${item}`);
    else beyondPoints.push(item);
  }
  if (!issues.some((item) => SELF_ADMISSION.test(item))) {
    const admission = String(studentAnswer)
      .split(/[。；;！!？?\n]/)
      .map((item) => item.trim())
      .find((item) => item && SELF_ADMISSION.test(item));
    if (admission) issues.push(`未掌握：${admission.slice(0, 100)}`);
  }

  return {
    score,
    isCorrect,
    matchedPoints,
    beyondPoints,
    issues: issues.slice(0, 4),
    explanation: String(obj.explanation || '').trim()
  };
}

exports.gradeAnswer = async (req, res) => {
  const body = req.body || {};
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const studentAnswer = typeof body.studentAnswer === 'string' ? body.studentAnswer.trim() : '';
  const kpTitle = typeof body.knowledgePointTitle === 'string' ? body.knowledgePointTitle.trim().slice(0, 200) : '';
  const kpContent = typeof body.knowledgePointContent === 'string' ? body.knowledgePointContent.trim() : '';
  const rawPoints = Array.isArray(body.answerKeyPoints)
    ? body.answerKeyPoints
    : typeof body.answerKeyPoints === 'string'
      ? body.answerKeyPoints.split(/\r?\n/)
      : [];
  const answerKeyPoints = rawPoints.map((item) => String(item).trim()).filter(Boolean);

  if (!question) return res.status(400).json({ msg: '缺少题目，无法阅卷' });
  if (!answerKeyPoints.length) return res.status(400).json({ msg: '缺少答案要点，无法阅卷' });
  if (!studentAnswer) return res.status(400).json({ msg: '请先填写你的回答' });
  if (question.length > MAX_QUESTION_CHARS || studentAnswer.length > MAX_ANSWER_CHARS) {
    return res.status(400).json({ msg: '题目或回答过长，请精简后重试' });
  }
  if (kpContent.length > MAX_INPUT_CHARS) {
    return res.status(400).json({ msg: `知识点内容过长，请控制在 ${MAX_INPUT_CHARS} 字以内` });
  }

  try {
    const normalizedAnswer = normalizeEquivalentTerms(studentAnswer);
    const normalizedKp = normalizeEquivalentTerms(kpContent);
    const raw = await requestEvaluationJson(
      buildGradePrompt(question, answerKeyPoints.map(normalizeEquivalentTerms), normalizedAnswer, {
        title: kpTitle,
        content: normalizedKp
      })
    );
    const grade = normalizeGrade(raw, studentAnswer);
    if (detectReversedTerm(normalizedAnswer, normalizedKp)) {
      grade.score = Math.min(grade.score, 30);
      grade.isCorrect = false;
      grade.issues = [
        '核心特性说反了：知识点是后进先出（LIFO），你的回答是先进先出（FIFO）',
        ...grade.issues
      ].slice(0, 4);
    }
    return res.json({ ...grade, studentAnswer });
  } catch (err) {
    return sendLlmError(res, err, '阅卷', '提交答案');
  }
};

// ==================== 第十一课：RAG 检索增强问答 ====================

const { queryVectorStore } = require('../services/vectorStoreService');

const MAX_QUESTION_INPUT_CHARS = 500;
const RAG_TOP_K = 4;
// 相似度低于该阈值的文本块视为不相关，不送给模型（防止拿无关内容硬答）
const RAG_MIN_SCORE = 0.35;

// 遵循课件「大模型上下文协议（MCP）」的结构化 Prompt：
// 用类 XML 标签明确各部分角色（背景资料 / 用户问题），减少歧义、抑制幻觉。
// 与课件的 PromptTemplate 等价，这里用函数拼接以便复用 callChatModel 的多通道路由。
function buildRagPrompt(context, question) {
  return `<role>你是「费曼学习平台」的私有知识库问答机器人。</role>
<instruction>请只根据下面<context>中提供的资料回答用户的<question>。要求：
1. 如果<context>中没有与问题相关的信息，就明确回答「知识库中暂无相关内容」，不要编造答案。
2. 回答简洁明了，用中文，可以使用 Markdown 排版。
3. 不要提及「上下文」「资料」等内部机制，像老师答疑一样自然作答。</instruction>

<context>
${context}
</context>

<question>
${question}
</question>`;
}

function formatRagDocs(docs) {
  return docs
    .map((doc, i) => `--- 文档 ${i + 1}（来自知识点《${doc.metadata.title}》） ---\n${doc.pageContent}`)
    .join('\n\n');
}

exports.answerWithRAG = async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) return res.status(400).json({ msg: '请输入问题' });
  if (question.length > MAX_QUESTION_INPUT_CHARS) {
    return res.status(400).json({ msg: `问题过长，请控制在 ${MAX_QUESTION_INPUT_CHARS} 字以内` });
  }

  try {
    // 1. 检索：问题向量化 → 在当前用户的向量库里找最相关的文本块
    const relevantDocs = await queryVectorStore(question, { userId: req.user.id, k: RAG_TOP_K });
    const usefulDocs = relevantDocs.filter((doc) => doc.score >= RAG_MIN_SCORE);

    // 2. 知识库为空或全都不相关时直接回答，不浪费一次模型调用
    if (!usefulDocs.length) {
      return res.json({
        answer: '知识库中暂无与该问题相关的内容。可以先创建相关知识点，或换个与已有知识点相关的问法。',
        sources: []
      });
    }

    // 3. 生成：把检索到的文本块和问题一起交给大模型（RAG 链的 LCEL 等价实现）
    const answer = await callChatModel(buildRagPrompt(formatRagDocs(usefulDocs), question));

    // 选做优化：返回引用来源，前端展示回答依据了哪些知识点，增加可信度
    const sourceMap = new Map();
    usefulDocs.forEach((doc) => {
      const id = doc.metadata.knowledgePointId;
      if (!sourceMap.has(id)) {
        sourceMap.set(id, { knowledgePointId: id, title: doc.metadata.title, score: doc.score, excerpt: doc.pageContent.slice(0, 120) });
      }
    });

    return res.json({ answer: String(answer || '').trim(), sources: [...sourceMap.values()] });
  } catch (err) {
    return sendLlmError(res, err, '问答', '提问');
  }
};
