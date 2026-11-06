// 用法：在 feynman-platform-backend 目录下执行
//   node scripts/check-llm.js                          测当前配置的大模型能否调通
//   node scripts/check-llm.js --full                   再跑一次完整的「润色 + 评价」，验证 JSON 可解析
//   node scripts/check-llm.js --list                   列出千帆 Key 可用的对话模型（仅 bce-v3）
//   node scripts/check-llm.js --model glm-4.7-flash --full  临时指定模型名
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');

const getArg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : '';
};

const LLM_BASE_URL = (process.env.LLM_BASE_URL || '').trim().replace(/\/+$/, '');
const LLM_API_KEY = (process.env.LLM_API_KEY || '').trim();
const LLM_MODEL = getArg('--model') || (process.env.LLM_MODEL || '').trim();
const QF_KEY = (process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY || '').trim();
const QF_SECRET = (process.env.QIANFAN_SECRET_KEY || process.env.BAIDU_SECRET_KEY || '').trim();

const useGeneric = Boolean(LLM_BASE_URL && LLM_API_KEY);
const useBearer = !useGeneric && QF_KEY.startsWith('bce-v3/');
const model = LLM_MODEL || (useBearer ? 'ernie-5.1' : 'eb-instant');

const mask = (s) => (!s ? '(空)' : s.length <= 8 ? s : `${s.slice(0, 6)}***${s.slice(-4)}`);

const HINTS = {
  6: [
    '千帆应用没有该模型的调用权限。',
    '去千帆控制台 → 应用接入 → 编辑应用 → 模型服务，勾选要用的模型后重试。',
    '语音技术应用默认不带大模型权限，必须单独在千帆开通。'
  ],
  invalid_model: ['模型名不可用或该 Key 没有此模型权限，执行 node scripts/check-llm.js --list 查看可用模型。'],
  model_not_found: ['模型名不存在，检查 .env 里的 LLM_MODEL 与服务商文档是否一致。'],
  account_overdue: [
    '账户处于欠费/受限状态，服务端直接拒绝请求。',
    '去服务商控制台充值或领取免费额度后再试；百度云看 https://console.bce.baidu.com/finance/ 。'
  ],
  invalid_api_key: ['API Key 无效，检查 .env 里的 LLM_API_KEY 是否复制完整、是否已被删除。'],
  insufficient_quota: ['免费额度已用完，换个账号/Key 或充值。'],
  insufficient_balance: ['账户余额不足。'],
  rate_limit_exceeded: ['请求过于频繁（429），等十几秒再试。']
};

const hint = (code) => HINTS[code] || [`未知错误码 ${code || '(空)'}，把上面的原始返回发出来再排查。`];

async function chat(prompt) {
  if (useGeneric) {
    const { data } = await axios.post(
      `${LLM_BASE_URL}/chat/completions`,
      { model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 },
      { headers: { Authorization: `Bearer ${LLM_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 }
    );
    return { text: data.choices?.[0]?.message?.content, raw: data };
  }

  if (useBearer) {
    const { data } = await axios.post(
      'https://qianfan.baidubce.com/v2/chat/completions',
      { model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 },
      { headers: { Authorization: `Bearer ${QF_KEY}` }, timeout: 60000 }
    );
    return { text: data.choices?.[0]?.message?.content, raw: data };
  }

  const { data: tok } = await axios.post(
    'https://aip.baidubce.com/oauth/2.0/token',
    null,
    {
      params: { grant_type: 'client_credentials', client_id: QF_KEY, client_secret: QF_SECRET },
      timeout: 15000
    }
  );
  if (!tok.access_token) {
    const err = new Error('千帆 access_token 获取失败');
    err.payload = tok;
    throw err;
  }
  const { data } = await axios.post(
    `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}`,
    { messages: [{ role: 'user', content: prompt }], temperature: 0.2 },
    { params: { access_token: tok.access_token }, timeout: 60000 }
  );
  return { text: data.result, raw: data };
}

function extractJson(raw) {
  const cleaned = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('返回内容不是 JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

(async () => {
  console.log('=== 1. 当前配置 ===');
  if (useGeneric) {
    console.log('调用方式 : OpenAI 兼容接口（第三方模型）');
    console.log('BASE_URL :', LLM_BASE_URL);
    console.log('API_KEY  :', mask(LLM_API_KEY));
  } else {
    console.log('调用方式 :', useBearer ? '千帆 bce-v3（Bearer）' : '千帆应用接入（access_token）');
    console.log('API_KEY  :', mask(QF_KEY));
    console.log('SECRET   :', mask(QF_SECRET));
  }
  console.log('模型     :', model || '(未配置)');

  if (!useGeneric && !QF_KEY) {
    console.log('\n没有读到任何大模型配置。请在 .env 里填 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。');
    return;
  }
  if (useGeneric && !LLM_MODEL) {
    console.log('\n使用第三方接口时必须配置 LLM_MODEL，例如 LLM_MODEL=glm-4.7-flash。');
    return;
  }

  if (process.argv.includes('--list')) {
    if (!useBearer) {
      console.log('\n--list 只适用于千帆 bce-v3 Key；其它服务商请查看其控制台的模型列表。');
      return;
    }
    try {
      const { data } = await axios.get('https://qianfan.baidubce.com/v2/models', {
        headers: { Authorization: `Bearer ${QF_KEY}` },
        timeout: 20000
      });
      const chatModels = (data.data || []).filter(
        (m) => m.status === 'active' && (m.type === 'chat' || m.type === 'multimodal')
      );
      console.log(`\n当前 Key 可用的对话模型（${chatModels.length} 个）：`);
      chatModels.forEach((m) => console.log(`  ${m.id}  (${m.model_name})`));
    } catch (err) {
      const status = err.response?.status;
      console.log(
        status === 429
          ? '\n请求太频繁（429），等几十秒再执行。'
          : `\n获取模型列表失败：HTTP ${status || '-'} ${JSON.stringify(err.response?.data || err.message)}`
      );
    }
    return;
  }

  console.log('\n=== 2. 调用模型 ===');
  try {
    const { text, raw } = await chat('请只回复两个字：收到');
    if (!text) {
      console.log('接口返回了 200，但内容为空：', JSON.stringify(raw).slice(0, 300));
      const code = raw.error_code || raw.error?.code;
      if (code) hint(code).forEach((l) => console.log('  ' + l));
      return;
    }
    console.log('成功！模型回复：', String(text).trim().slice(0, 60));
  } catch (err) {
    const data = err.payload || err.response?.data || {};
    const code = data.error_code || data.error?.code || data.error;
    console.log('失败：', err.message);
    console.log('原始返回：', JSON.stringify(data).slice(0, 400));
    if (code) hint(code).forEach((l) => console.log('  ' + l));
    return;
  }

  if (!process.argv.includes('--full')) {
    console.log('\n模型能调通。要验证完整的润色+评分链路，再加上 --full。');
    return;
  }

  console.log('\n=== 3. 完整评价链路（润色 + 评分 + JSON 解析）===');
  const prompt = `你是一个严格而友善的计算机科学学习教练。你的任务是评估学生对一个知识点的复述，并给出反馈。

【原始知识点】:
\`\`\`
React 的 useState 返回一个状态值和一个更新函数，更新函数触发重新渲染。
\`\`\`

【学生的口头复述文本】:
\`\`\`
嗯就是 useState 嘛，它给你一个值还有一个 set 函数，你调 set 它就会重新渲染一下这样。
\`\`\`

请你完成以下三项任务:
1. 将复述文本润色成通顺书面语，保持核心观点不变。
2. 基于原始知识点评价学生的复述，指出优点和可改进处。
3. 综合准确性、完整性、逻辑性、流畅性给出 0 到 100 的整数分数。

请严格按照以下JSON格式返回，不要包含任何额外解释：
{"polishedText":"...","evaluation":"...","strengths":["..."],"weaknesses":["..."],"score":85}`;

  try {
    const { text } = await chat(prompt);
    const obj = extractJson(text);
    console.log('polishedText:', obj.polishedText);
    console.log('evaluation  :', obj.evaluation);
    console.log('strengths   :', (obj.strengths || []).join(' / '));
    console.log('weaknesses  :', (obj.weaknesses || []).join(' / '));
    console.log('score       :', obj.score, typeof obj.score === 'number' ? '(数字，可直接入库)' : '(非数字，需要检查)');
  } catch (err) {
    console.log('链路失败：', err.message);
    if (err.response?.data) console.log('原始返回：', JSON.stringify(err.response.data).slice(0, 400));
  }
})().catch((e) => console.error('脚本异常：', e.message));
