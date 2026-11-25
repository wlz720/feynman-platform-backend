// 灌入演示用知识点到当前登录账号（通过后端 HTTP API，不直连数据库）
// 用法：
//   SEED_EMAIL=xxx@xx.com SEED_PASSWORD=xxx node scripts/seed-demo-kps.js
//   或：node scripts/seed-demo-kps.js <email> <password>
// 说明：先按标题去重，已存在的同名知识点跳过；新建后再回写学习状态与复习标记。
const axios = require('axios');

const BASE = process.env.SEED_API_BASE || 'http://localhost:3000/api';

const DEMO_KPS = [
  {
    title: 'HTTP 与 HTTPS',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
HTTP 是浏览器与服务器之间传输超文本的应用层协议；HTTPS 在 HTTP 下层加了 TLS 加密，保证内容机密、完整且可验证身份。

## 核心要点
- **请求方法**：GET 查、POST 增、PUT 改、DELETE 删，HEAD 只取响应头。
- **常见状态码**：200 成功、301/302 重定向、400 参数错误、401 未登录、403 无权限、404 不存在、500 服务器错误。
- **报文结构**：请求行/状态行 + 请求头/响应头 + 空行 + 请求体/响应体。
- **HTTPS 优势**：加密防窃听、校验完整性防篡改、证书验证服务器身份。

## 易错提醒
- 401 是没带凭证或凭证无效，403 是已识别但没权限，两者不要混。
- HTTPS 只是传输层加密，不代表接口业务逻辑一定安全。`
  },
  {
    title: 'CSS 盒模型与定位',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
盒模型描述一个元素由内容（content）、内边距（padding）、边框（border）、外边距（margin）四部分组成；定位规则决定它在页面中的摆放位置。

## 核心要点
- **box-sizing**：\`content-box\` 宽高只算内容；\`border-box\` 宽高含 padding 与 border，布局更可控。
- **定位方式**：static 静态、relative 相对自身偏移、absolute 相对最近定位祖先、fixed 相对视口、sticky 滚动到阈值后吸附。
- **层叠**：定位元素用 z-index 控制上下层叠，父级层叠上下文会限制子级。
- **普通流**：块级元素纵向排列，行内元素横向排列，float 与定位会脱离普通流。

## 易错提醒
- relative 不脱离文档流，仍占位；absolute / fixed 脱离文档流，不占原位置。
- margin 会折叠，padding 不会；盒模型宽度默认不含 border 和 padding。`
  },
  {
    title: '进程与线程',
    status: 'not_started',
    reviewList: false,
    content: `## 一句话定义
进程是操作系统分配资源的最小单位，线程是进程内执行调度的最小单位；一个进程可以包含多个共享其资源的线程。

## 核心要点
- **进程**：有独立地址空间，进程间通信（IPC）成本高，一个进程崩溃通常不影响其他进程。
- **线程**：同进程内共享堆、全局变量与文件句柄，切换成本低，一个线程崩溃可能拖垮整个进程。
- **并发与并行**：并发是交替推进多任务，并行是同一时刻多核同时执行。
- **典型模型**：多进程、多线程、协程（用户态轻量线程）。

## 易错提醒
- 线程上下文切换比进程轻，但共享资源带来竞态，需要加锁同步。
- Node.js 主线程单线程，但通过事件循环异步处理 IO，不等于只能做一件事。`
  },
  {
    title: 'JWT 鉴权流程',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
JWT（JSON Web Token）是一种无状态的令牌：登录后服务器签发一段含用户信息的加密字符串，后续请求带上它即可识别身份，不必在服务端存会话。

## 核心要点
- **三段结构**：Header（算法与类型）、Payload（用户标识与声明）、Signature（签名校验），用点号连接。
- **流程**：账号密码登录 → 服务端校验并签发 token → 前端保存并在请求头携带 → 服务端验签后放行。
- **验签关键**：用密钥校验签名是否被篡改，Payload 只是编码，不能放敏感明文。
- **过期处理**：设置过期时间，必要时用刷新令牌（refresh token）续期。

## 易错提醒
- JWT 默认不加密，Payload 可被解码查看，不要写密码等敏感信息。
- 登出在纯前端很难真正作废已签发 token，通常靠短过期期 + 黑名单实现。`
  },
  {
    title: '数据库索引与 B+ 树',
    status: 'not_started',
    reviewList: false,
    content: `## 一句话定义
索引是为加速查询而建立的数据结构；关系型数据库常用 B+ 树组织索引，把有序键值存放在多层平衡树上，减少磁盘 IO 次数。

## 核心要点
- **B+ 树特点**：非叶子节点只存键，数据都在叶子节点；叶子节点有序链表相连，适合范围查询。
- **索引收益**：把全表扫描降到树高次数级别的查找，加速 WHERE、ORDER BY、JOIN。
- **代价**：占用存储空间，写入时要同步维护索引，索引过多会拖慢增删改。
- **适用场景**：高频过滤、排序、关联的列；区分度低的列（如性别）建索引收益小。

## 易错提醒
- 索引不是越多越好，要结合查询语句和最左前缀原则设计。
- 模糊查询前置通配符（\`%xx\`）通常无法有效利用 B+ 树索引。`
  },
  {
    title: '浏览器渲染流程：从 HTML 到像素',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
浏览器把 HTML、CSS、JavaScript 转成屏幕像素的过程，大致经过解析构建 DOM/CSSOM、合成渲染树、布局回流、绘制与合成几个阶段。

## 核心要点
1. **解析**：HTML 解析成 DOM 树，CSS 解析成 CSSOM 树。
2. **渲染树**：DOM 与 CSSOM 合并成 Render Tree，只包含可见节点。
3. **布局（回流 reflow）**：计算每个元素的几何位置与尺寸。
4. **绘制（repaint）**：填充颜色、文字、图像等像素。
5. **合成（composite）**：图层合并上屏，transform、opacity 常可只走合成层。

## 易错提醒
- 改变几何尺寸会触发回流，代价高；只改颜色/背景触发重绘；改 transform/opacity 走合成最快。
- 频繁读写样式要先缓存读取，避免强制同步布局（layout thrashing）。`
  },
  {
    title: '数组与链表',
    status: 'need_review',
    reviewList: true,
    content: `## 一句话定义
数组在连续内存中存元素，靠下标随机访问；链表用指针把零散节点串起来，插入删除不必移动整块数据。

## 核心要点
- **数组**：随机访问 O(1)，中间插入/删除 O(n)，连续存储，缓存友好。
- **链表**：访问第 i 个元素 O(n)，已知节点的插入/删除 O(1)，内存零散、有指针开销。
- **变种**：单链表、双向链表、循环链表；常见应用有链表反转、环检测、合并有序链表。

## 易错提醒
- 链表省了搬移数据的时间，但不支持下标随机访问，查找不能二分。
- 实际工程中顺序结构多用动态数组（如 JS 数组 / Python list），链表更适合频繁头尾增删的场景。`
  },
  {
    title: '递归与分治',
    status: 'mastered',
    reviewList: false,
    content: `## 一句话定义
递归是函数不断调用自身直到触达基线条件；分治把大问题拆成同类子问题，分别求解后再合并结果。

## 核心要点
- **递归三要素**：基线条件（出口）、递推关系、收敛到出口的参数变化。
- **分治步骤**：分解（divide）→ 解决（conquer）→ 合并（combine）。
- **典型例子**：归并排序、快速排序、二叉树遍历、汉诺塔、阶乘与斐波那契。
- **代价**：递归调用占用调用栈，层数过深可能栈溢出；重复子问题可加记忆化优化。

## 易错提醒
- 没有基线条件或参数不收敛会无限递归，最终栈溢出。
- 递归写法简洁，但要关注栈深度与重复计算，必要时改写成迭代或加缓存。`
  }
];

async function main() {
  const email = process.argv[2] || process.env.SEED_EMAIL;
  const password = process.argv[3] || process.env.SEED_PASSWORD;
  if (!email || !password) {
    console.error('请提供账号邮箱和密码：node scripts/seed-demo-kps.js <email> <password>');
    process.exit(1);
  }

  let token;
  try {
    const login = await axios.post(`${BASE}/users/login`, { email, password });
    token = login.data.token;
    console.log(`登录成功：${login.data.user?.username || email}`);
  } catch (err) {
    console.error('登录失败：', err.response?.data?.msg || err.message);
    process.exit(1);
  }

  const http = axios.create({
    baseURL: BASE,
    headers: { 'x-auth-token': token }
  });

  // 取现有知识点标题用于去重
  const existing = await http.get('/knowledge-points');
  const seen = new Set((existing.data || []).map((k) => k.title));
  console.log(`当前已有 ${seen.size} 个知识点`);

  let created = 0;
  let skipped = 0;
  for (const kp of DEMO_KPS) {
    if (seen.has(kp.title)) {
      console.log(`· 跳过（已存在）：${kp.title}`);
      skipped += 1;
      continue;
    }
    try {
      const res = await http.post('/knowledge-points', { title: kp.title, content: kp.content });
      const id = res.data._id;
      await http.put(`/knowledge-points/${id}`, { status: kp.status, reviewList: kp.reviewList });
      console.log(`· 已创建：${kp.title}（${kp.status}）`);
      created += 1;
    } catch (err) {
      console.error(`  创建失败：${kp.title} ——`, err.response?.data?.msg || err.message);
    }
  }

  console.log(`\n完成：新建 ${created} 个，跳过 ${skipped} 个。`);
  process.exit(0);
}

main().catch((err) => {
  console.error('脚本异常：', err.response?.data || err.message);
  process.exit(1);
});
