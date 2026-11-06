// 用法：在 feynman-platform-backend 目录下执行
//   node scripts/check-xss.js          验证「入库前消毒」对各类内容的处理
//   node scripts/check-xss.js --db     只读检查库里是否还残留 <script>/onerror 等载荷
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { sanitizeMarkdown, sanitizeTitle } = require('../utils/sanitizeMarkdown');

const cases = [
  {
    name: '普通段落里的 <script> 被删除',
    input: "# 正常标题\n\n<script>alert('Hacked!')</script>\n\n正文保留。",
    assert: (out) => !/<script/i.test(out) && /# 正常标题/.test(out) && /正文保留/.test(out)
  },
  {
    name: '<img onerror> 被删除',
    input: '看看这个 <img src="invalid-source" onerror="alert(\'XSS via image\')" />',
    assert: (out) => !/<img/i.test(out) && !/onerror/i.test(out)
  },
  {
    name: 'iframe / style / svg 等标签被删除',
    input: '<iframe src="javascript:alert(1)"></iframe>\n<svg onload="alert(1)"></svg>\n<style>body{display:none}</style>',
    assert: (out) => !/<(iframe|svg|style)/i.test(out) && !/javascript:/i.test(out)
  },
  {
    name: '围栏代码块原样保留（教学示例需要展示代码）',
    input: '```markdown\n<script>alert(1)</script>\n<img onerror="x" />\n```',
    assert: (out) => out.includes('<script>alert(1)</script>') && out.includes('<img onerror="x" />')
  },
  {
    name: '行内代码原样保留',
    input: '不要用 `<script>` 标签。',
    assert: (out) => out.includes('`<script>`')
  },
  {
    name: '引用块、公式与自动链接不被破坏',
    input: '若 $a < b$，见 <https://example.com>\n\n> 引用',
    assert: (out) => out.includes('$a < b$') && out.includes('<https://example.com>') && out.includes('> 引用')
  }
];

let failed = 0;
console.log('=== 入库消毒自检 ===');
cases.forEach(({ name, input, assert }) => {
  const output = sanitizeMarkdown(input);
  const pass = assert(output);
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) console.log('      输出：', JSON.stringify(output));
});

const titleCases = [
  {
    name: '标题里的 <script> 被清除',
    input: "<script>alert(1)</script>C++ 模板",
    assert: (out) => !/<script/i.test(out) && out.includes('C++ 模板')
  },
  {
    name: '标题保留 C++ 模板 <T> 的正常写法',
    input: 'C++ 模板 <T>',
    assert: (out) => out === 'C++ 模板 <T>'
  }
];
titleCases.forEach(({ name, input, assert }) => {
  const output = sanitizeTitle(input);
  const pass = assert(output);
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  if (!pass) console.log('      输出：', JSON.stringify(output));
});

async function checkDb() {
  const mongoose = require('mongoose');
  const KnowledgePoint = require('../models/KnowledgePoint');
  console.log('\n=== 数据库残留检查（只读）===');
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    // 用同一个消毒函数比对：内容会变，说明库里还留着可被删除的原始 HTML
    const all = await KnowledgePoint.find({}).select('title content').lean();
    const dirty = all.filter(
      (kp) =>
        sanitizeMarkdown(kp.content || '') !== (kp.content || '') ||
        sanitizeTitle(kp.title || '') !== (kp.title || '')
    );

    if (!dirty.length) {
      console.log(`PASS  共检查 ${all.length} 条，没有残留的原始 HTML。`);
    } else {
      console.log(`共检查 ${all.length} 条，其中 ${dirty.length} 条仍含原始 HTML（多为消毒上线前保存的旧数据）：`);
      dirty.slice(0, 20).forEach((kp) => console.log(`  - ${kp.title} (${kp._id})`));
      if (dirty.length > 20) console.log(`  …… 其余 ${dirty.length - 20} 条略`);
      console.log('提示：在页面里打开并重新保存一次，即可触发入库消毒。');
    }
  } catch (err) {
    console.log('跳过：数据库连接失败 —', err.message);
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

(async () => {
  if (process.argv.includes('--db')) await checkDb();
  console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
  process.exitCode = failed ? 1 : 0;
})();
