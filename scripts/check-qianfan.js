// 用法：在 feynman-platform-backend 目录下执行
//   node scripts/check-qianfan.js                          只测凭证能否调通文心模型
//   node scripts/check-qianfan.js --full                   再跑一次完整的「润色 + 评价」，验证 JSON 能被解析
//   node scripts/check-qianfan.js --list                   列出当前 Key 可用的对话模型
//   node scripts/check-qianfan.js --model ernie-5.1 --full 临时指定模型名
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const axios = require('axios');

const argModel = process.argv.indexOf('--model') > -1 ? process.argv[process.argv.indexOf('--model') + 1] : '';
const API_KEY = process.env.QIANFAN_API_KEY || process.env.BAIDU_API_KEY || '';
const SECRET_KEY = process.env.QIANFAN_SECRET_KEY || process.env.BAIDU_SECRET_KEY || '';
const MODEL = argModel || process.env.QIANFAN_MODEL || '';
const useBearer = API_KEY.startsWith('bce-v3/');

const mask = (s) => (s.length <= 8 ? s : `${s.slice(0, 6)}***${s.slice(-4)}`);

const HINTS = {
  6: [
    '应用没有该模型的调用权限。',
    '去千帆控制台 → 应用接入 → 编辑应用 → 模型服务，勾选要用的文心模型（如 ERNIE-Bot-turbo / ERNIE-Speed），保存后重试。',
    '语音技术应用默认不带大模型权限，必须单独在千帆开通。'
  ],
  invalid_model: ['模型名不可用或该 Key 没有此模型权限，执行 node scripts/check-qianfan.js --list 查看可用模型。'],
  account_overdue: [
    '百度智能云账户处于欠费/受限状态，服务端直接拒绝请求。',
    '去 https://console.bce.baidu.com/finance/ 查看是否欠费，按提示充值（几元即可恢复）；',
    '再到千帆控制台确认已「开通付费」或领取了免费额度。充值后重新执行本脚本即可。'
  ],
  110: ['access_token 无效：API Key 与 Secret Key 不属于同一个应用，或复制不全。'],
  111: ['access_token 已过期，重新执行本脚本即可（服务端会自动换新的）。'],
  17: ['当日调用量已达上限，明天再试或换更便宜的模型。'],
  18: ['并发超限，稍等几秒重试。'],
  336100: ['内容触发了安全审核，换一段中性文本测试。'],
  336501: ['账户额度不足，去千帆控制台充值或改用免费模型（ernie-speed / ernie-lite）。']
};

function hint(code) {
  return HINTS[code] || ['未知错误码，把上面的原始返回发出来再排查。'];
}

async function getV1Token() {
  const { data } = await axios.post(
    'https://aip.baidubce.com/oauth/2.0/token',
    null,
    {
      params: { grant_type: 'client_credentials', client_id: API_KEY, client_secret: SECRET_KEY },
      timeout: 15000
    }
  );
  if (!data.access_token) {
    const err = new Error('换 token 失败');
    err.detail = data;
    throw err;
  }
  return data.access_token;
}

async function chat(prompt) {
  if (useBearer) {
    const { data } = await axios.post(
      'https://qianfan.baidubce.com/v2/chat/completions',
      {
        model: MODEL || 'ernie-5.1',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2
      },
      { headers: { Authorization: `Bearer ${API_KEY}` }, timeout: 60000 }
    );
    return { text: data.choices?.[0]?.message?.content, raw: data };
  }

  const token = await getV1Token();
  const { data } = await axios.post(
    `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${MODEL || 'eb-instant'}`,
    { messages: [{ role: 'user', content: prompt }], temperature: 0.2 },
    { params: { access_token: token }, timeout: 60000 }
  );
  return { text: data.result, raw: data };
}

(async () => {
  console.log('=== 1. 本地读取到的凭证 ===');
  console.log('API_KEY   :', mask(API_KEY), `(长度 ${API_KEY.length})`);
  console.log('SECRET_KEY:', SECRET_KEY ? `${mask(SECRET_KEY)} (长度 ${SECRET_KEY.length})` : '(未配置)');
  console.log('鉴权方式  :', useBearer ? 'Bearer（bce-v3 新版 API Key）' : 'access_token（应用接入 API Key/Secret）');
  console.log('模型      :', MODEL || (useBearer ? 'ernie-5.1（默认）' : 'eb-instant（默认）'));

  if (!API_KEY) {
    console.log('\n.env 里没有 QIANFAN_API_KEY，也没有 BAIDU_API_KEY，先配置。');
    return;
  }
  if (!useBearer && !SECRET_KEY) {
    console.log('\n走应用接入方式时必须同时有 QIANFAN_API_KEY 和 QIANFAN_SECRET_KEY。');
    return;
  }

  if (process.argv.includes('--list')) {
    if (!useBearer) {
      console.log('\n--list 只适用于 bce-v3 新版 Key，旧版应用请到千帆控制台「模型服务」查看已开通模型。');
      return;
    }
    let listResp;
    try {
      listResp = await axios.get('https://qianfan.baidubce.com/v2/models', {
        headers: { Authorization: `Bearer ${API_KEY}` },
        timeout: 20000
      });
    } catch (err) {
      const status = err.response?.status;
      console.log(
        status === 429
          ? '\n请求太频繁（429），等几十秒再执行。'
          : `\n获取模型列表失败：HTTP ${status || '-'} ${JSON.stringify(err.response?.data || err.message)}`
      );
      return;
    }
    const chatModels = (listResp.data.data || []).filter(
      (m) => m.status === 'active' && (m.type === 'chat' || m.type === 'multimodal')
    );
    console.log(`\n当前 Key 可用的对话模型（${chatModels.length} 个）：`);
    chatModels.forEach((m) => console.log(`  ${m.id}  (${m.model_name})`));
    if (chatModels.length) {
      console.log(`\n把其中一个写进 .env，例如：QIANFAN_MODEL=${chatModels[0].id}`);
    }
    return;
  }

  console.log('\n=== 2. 调用文心模型 ===');
  let text;
  try {
    const { text: t, raw } = await chat('请只回复两个字：收到');
    if (!t) {
      console.log('接口返回了 200，但没有 result：', JSON.stringify(raw).slice(0, 300));
      if (raw.error_code) hint(raw.error_code).forEach((l) => console.log('  ' + l));
      return;
    }
    text = t;
    console.log('成功！模型回复：', String(text).trim().slice(0, 60));
  } catch (err) {
    const data = err.detail || err.response?.data || {};
    const code = data.error_code || data.error?.code;
    console.log('失败：', err.message);
    console.log('原始返回：', JSON.stringify(data).slice(0, 400));
    if (code) hint(code).forEach((l) => console.log('  ' + l));
    return;
  }

  if (!process.argv.includes('--full')) {
    console.log('\n凭证和权限都没问题。要验证完整的润色+评分链路，再执行：node scripts/check-qianfan.js --full');
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
    const { text: out, raw } = await chat(prompt);
    if (!out) {
      console.log('没有拿到 result：', JSON.stringify(raw).slice(0, 300));
      return;
    }
    const cleaned = String(out).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const obj = JSON.parse(cleaned.slice(start, end + 1));
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
