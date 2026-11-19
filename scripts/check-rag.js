// 用法：在 feynman-platform-backend 目录下执行
//   node scripts/check-rag.js            分割 → 向量化 → 入库 → 相似度检索 全链路自检
//   node scripts/check-rag.js --stats    只查看当前向量库统计
//   node scripts/check-rag.js --query "React Hooks有什么好处"   对现有库检索
// 自检使用独立的演示用户/知识点 id，结束后自动清理，不污染真实数据。
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const {
  splitText,
  addKnowledgePointToStore,
  removeKnowledgePointFromStore,
  queryVectorStore,
  getStoreStats
} = require('../services/vectorStoreService');

const DEMO_USER = 'rag-check-user';
const DEMO_KP_1 = 'rag-check-kp-hooks';
const DEMO_KP_2 = 'rag-check-kp-vue';

const SAMPLE_HOOKS = `React Hooks 是 React 16.8 引入的特性，它让函数组件也能使用状态和其他 React 特性。
useState 返回一个状态值和一个更新函数，调用更新函数会触发组件重新渲染。
useEffect 用于处理副作用，比如数据请求、订阅和手动修改 DOM，它在渲染完成后执行。
Hooks 的好处是逻辑复用更简单：可以把相关逻辑抽成自定义 Hook，而不是用高阶组件或 render props 层层嵌套。
使用 Hooks 时要遵守两条规则：只在函数组件或自定义 Hook 的顶层调用，不要在循环、条件或嵌套函数中调用。`;

const SAMPLE_VUE = `Vue 3 的 Composition API 通过 setup 函数组织组件逻辑。
ref 用于声明响应式的基本类型数据，reactive 用于声明响应式对象。
computed 声明计算属性，watch 和 watchEffect 用于侦听响应式数据的变化并执行副作用。
Composition API 的优势在于可以把同一个功能的逻辑集中在一起，并方便抽取成可复用的组合式函数。`;

(async () => {
  if (process.argv.includes('--stats')) {
    console.log('向量库统计：', await getStoreStats());
    return;
  }

  const queryIndex = process.argv.indexOf('--query');
  if (queryIndex > -1) {
    const question = process.argv[queryIndex + 1];
    if (!question) {
      console.log('请在 --query 后面带上问题文本。');
      return;
    }
    const docs = await queryVectorStore(question, { k: 4 });
    console.log(`检索到 ${docs.length} 个相关文本块：`);
    docs.forEach((doc, i) => {
      console.log(`  [${i + 1}] 相似度 ${doc.score.toFixed(4)} 《${doc.metadata.title}》 ${doc.pageContent.slice(0, 60)}...`);
    });
    return;
  }

  console.log('=== 1. 文本分割（不联网） ===');
  const chunks = splitText(SAMPLE_HOOKS);
  console.log(`示例文本 ${SAMPLE_HOOKS.length} 字，被分割成 ${chunks.length} 个文本块：`);
  chunks.forEach((chunk, i) => console.log(`  [${i + 1}] ${chunk.length} 字：${chunk.slice(0, 40)}...`));

  console.log('\n=== 2. 向量化并入库（调用 Embedding 接口） ===');
  await addKnowledgePointToStore({ _id: DEMO_KP_1, user: DEMO_USER, title: 'React Hooks', content: SAMPLE_HOOKS });
  await addKnowledgePointToStore({ _id: DEMO_KP_2, user: DEMO_USER, title: 'Vue Composition API', content: SAMPLE_VUE });
  console.log('入库后统计：', await getStoreStats());

  console.log('\n=== 3. 相似度检索 ===');
  const question = 'React Hooks 有什么好处？';
  const docs = await queryVectorStore(question, { userId: DEMO_USER, k: 2 });
  if (!docs.length) {
    console.log('没有检索到结果，请检查上一步是否入库成功。');
  } else {
    console.log(`问题「${question}」命中 ${docs.length} 个文本块：`);
    docs.forEach((doc, i) => {
      console.log(`  [${i + 1}] 相似度 ${doc.score.toFixed(4)} 《${doc.metadata.title}》`);
      console.log(`      ${doc.pageContent.slice(0, 80)}...`);
    });
    const topIsHooks = docs[0].metadata.title === 'React Hooks';
    console.log(topIsHooks ? '✅ 最相关结果来自 React Hooks，语义检索正常。' : '⚠️ 最相关结果不是 React Hooks，请检查 Embedding 模型。');
  }

  console.log('\n=== 4. 清理演示数据 ===');
  await removeKnowledgePointFromStore(DEMO_KP_1);
  await removeKnowledgePointFromStore(DEMO_KP_2);
  console.log('清理后统计：', await getStoreStats());
})().catch((err) => {
  console.error('自检失败：', err.response?.data || err.message);
  if (err.code === 'NO_CREDENTIAL') {
    console.error('请先在 .env 配置 LLM_BASE_URL / LLM_API_KEY（智谱等 OpenAI 兼容服务商），可选 EMBEDDING_MODEL。');
  }
  process.exitCode = 1;
});