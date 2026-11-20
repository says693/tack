import type { GuidedRun, GuidedSource, GuidedStudyApi } from '@/lib/guided-study';

// Dev-only fixtures exercise the browser UI without a model, network access, or an API key.
interface PreviewItem {
  explanation: string;
  example: string;
  prompt: string;
  referenceAnswer: string;
  correction: string;
  quote: string;
}

interface PreviewProfile {
  aliases: string[];
  source: Omit<GuidedSource, 'license' | 'text'>;
  overview: string;
  items: PreviewItem[];
}

const profiles: PreviewProfile[] = [
  {
    aliases: ['物理', '初中物理', 'physics', '光的反射', '反射定律', '光的反射定律', 'light reflection', 'reflection of light', 'law of reflection'],
    source: {
      id: 'optics-reflection',
      title: '光的反射：反射定律',
      publisher: 'NASA Science',
      url: 'https://science.nasa.gov/universe/glossary/#reflection-law',
      scope: '光的反射',
    },
    overview: '认识反射定律、法线和垂直入射。',
    items: [
      {
        explanation: '把入射光线和反射光线分别与法线比较，会发现这两个夹角相等。',
        example: '如果入射角是 30°，反射角也一定是 30°。',
        prompt: '入射角和反射角有什么关系？',
        referenceAnswer: '反射角等于入射角。',
        correction: '两个角都以法线为基准。',
        quote: '反射角等于入射角。',
      },
      {
        explanation: '先找到入射点，再过这个点画一条垂直于反射面的直线，这条线就是法线。',
        example: '如果镜面是水平的，入射点的法线是竖直的。',
        prompt: '怎样在镜面上的入射点画出法线？',
        referenceAnswer: '过入射点画一条与镜面垂直的线。',
        correction: '这条线经过入射点，并且和镜面成直角。',
        quote: '法线在入射点与反射面垂直。',
      },
      {
        explanation: '光沿法线照向反射面时，入射角是零，反射光会沿原来的路线折回。',
        example: '把光沿竖直方向照向水平镜面，光会朝上反射。',
        prompt: '光垂直于镜面入射时，反射光怎样传播？',
        referenceAnswer: '沿入射光原来的路线反向传播。',
        correction: '垂直入射时，入射角和反射角都为零。',
        quote: '光线垂直照到反射面时，入射角和反射角都是零，反射光沿原路返回。',
      },
    ],
  },
  {
    aliases: ['数学', '初中数学', 'math', '一元一次方程', '解一元一次方程', 'linear equation in one variable', 'linear equations in one variable'],
    source: {
      id: 'algebra-linear-equations',
      title: '一元一次方程：等式的变形与检验',
      publisher: 'Siyavula',
      url: 'https://www.siyavula.com/read/za/mathematics/grade-10/equations-and-inequalities/04-equations-and-inequalities-01',
      scope: '一元一次方程',
    },
    overview: '用等式的加减、乘除和代入解方程。',
    items: [
      {
        explanation: '等式两边同时减去同一个数，不会改变方程的解。',
        example: 'x + 4 = 9 的两边同时减去 4，得到 x = 5。',
        prompt: 'x + 3 = 8 的两边都减去 3 后，得到什么？',
        referenceAnswer: 'x = 5。',
        correction: '左边的 +3 被消去，右边是 8 − 3。',
        quote: '在等式两边同时加上或减去同一个数，等式仍然成立。',
      },
      {
        explanation: '等式两边同时除以未知数的非零系数，可以把系数化为 1。',
        example: '5x = 20 的两边都除以 5，得到 x = 4。',
        prompt: '对 3x = 21 进行什么操作，可以只留下 x？',
        referenceAnswer: '两边都除以 3，得到 x = 7。',
        correction: '两边使用同一个非零除数。',
        quote: '在等式两边同时乘以或除以同一个非零数，得到的方程与原方程的解相同。',
      },
      {
        explanation: '用原方程检查求出的数，分别计算左右两边，再比较它们的值。',
        example: '将 x = 2 代入 x + 2 = 4，左边和右边都等于 4。',
        prompt: '数字 5 是方程 2x + 1 = 11 的解吗？怎样检验？',
        referenceAnswer: '是。代入后左边是 2 × 5 + 1 = 11，与右边相等。',
        correction: '代入原方程后，两边相等才是解。',
        quote: '检验时，把求出的数代入原方程；如果左右两边的值相等，它就是原方程的解。',
      },
    ],
  },
  {
    aliases: ['python', 'python 入门', 'python入门', 'python 控制流', 'python控制流', 'python control flow', 'python 控制流（if / for / range）'],
    source: {
      id: 'python-control-flow',
      title: 'Python 控制流：条件分支与循环',
      publisher: 'Python Software Foundation',
      url: 'https://docs.python.org/3.14/tutorial/controlflow.html',
      scope: 'Python 控制流（if / for / range）',
    },
    overview: '认识条件判断、遍历和 range 的边界。',
    items: [
      {
        explanation: 'Python 从 if 开始检查条件，一旦遇到真条件，就执行该分支并跳过后续分支。',
        example: '如果 n 是 5，先判断 n > 0，再用 elif 判断 n > 2，只运行第一段。',
        prompt: '如果 if 和后面的 elif 条件都成立，会执行几段？',
        referenceAnswer: '只执行第一段，因为它是第一个满足条件的分支。',
        correction: 'if 与其 elif 属于同一组判断。',
        quote: 'Python 按顺序检查 if 和 elif 的条件，只执行第一个条件为真的分支。',
      },
      {
        explanation: 'for 循环可以按顺序处理列表里的每一个元素。',
        example: '在 for n in [4, 6] 的循环中，n 先是 4，下一轮是 6。',
        prompt: '遍历列表 [2, 5, 1] 时，最后一轮取到什么值？',
        referenceAnswer: '1。',
        correction: '循环按照列表中元素的顺序进行，不会先给列表排序。',
        quote: 'for 循环从可迭代对象中逐个取出元素，每次把取到的元素赋给循环目标。',
      },
      {
        explanation: 'range(stop) 从零开始，产生小于 stop 的所有非负整数。',
        example: 'range(3) 依次产生 0、1、2。',
        prompt: 'range(4) 依次产生哪些数字？',
        referenceAnswer: '0、1、2、3。',
        correction: '结束参数 4 不在结果中。',
        quote: 'range(stop) 从零开始按步长一产生整数，不包含 stop。',
      },
    ],
  },
  {
    aliases: ['网络', '计算机网络', 'http', 'http 请求', 'http 协议', 'http 请求与响应', '网络请求'],
    source: {
      id: 'network-http-basics',
      title: '计算机网络：HTTP 请求与响应',
      publisher: 'MDN / IETF RFC 9110',
      url: 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Overview',
      scope: 'HTTP 请求与响应',
    },
    overview: '理解请求方法、状态码与无状态请求响应模型。',
    items: [
      {
        explanation: 'HTTP 每次交互都由客户端发起请求、服务器返回响应，双方本身不保存上一次连接的状态。',
        example: '浏览器打开网页时，先发出 GET 请求，服务器返回 HTML 后本次请求即告完成。',
        prompt: '为什么说 HTTP 协议本质上是“无状态”的？',
        referenceAnswer: '服务器默认不会记住同客户端上一次请求的状态，每次请求都相互独立。',
        correction: '需要登录态时，通常依赖 Cookie 或 Token 在每次请求里重新携带凭据。',
        quote: 'HTTP 是无状态协议，服务器默认在两次独立请求之间不保留客户端状态。',
      },
      {
        explanation: '请求方法表明动作语义：GET 用于获取资源，POST 通常用于提交数据或触发新资源创建。',
        example: '刷新文章列表使用 GET，提交表单创建订单通常使用 POST。',
        prompt: '只读取页面数据时通常使用哪种 HTTP 方法？',
        referenceAnswer: 'GET 方法。',
        correction: 'GET 应保持安全与只读语义，不应用于修改服务器核心状态。',
        quote: 'GET 请求用于获取指定资源，不应在服务端产生修改状态的副作用。',
      },
      {
        explanation: 'HTTP 响应状态码用三位数字概括结果：2xx 表示成功，4xx 表示客户端请求有误，5xx 表示服务端错误。',
        example: '返回 404 表示请求的路径不存在，返回 200 表示请求成功并附带响应体。',
        prompt: '收到 404 状态码和 500 状态码，分别指向哪一侧的问题？',
        referenceAnswer: '404 属于客户端请求问题（资源未找到），500 属于服务器端处理错误。',
        correction: '4xx 与 5xx 分别区分请求侧与服务侧责任，排查路径完全不同。',
        quote: '状态码以 2xx 表示成功处理，4xx 表示客户端请求错误，5xx 表示服务器内部异常。',
      },
    ],
  },
  {
    aliases: ['化学', '初中化学', '高中化学', '氧化还原', '氧化还原反应', '电子转移', 'redox'],
    source: {
      id: 'chemistry-redox',
      title: '化学基础：氧化还原与电子转移',
      publisher: 'IUPAC Gold Book / LibreTexts',
      url: 'https://chem.libretexts.org/Bookshelves/General_Chemistry',
      scope: '氧化还原反应',
    },
    overview: '从电子得失与化合价升降理解氧化与还原。',
    items: [
      {
        explanation: '氧化还原反应的核心不是“有没有氧气参加”，而是反应前后元素发生了电子转移。',
        example: '铁与硫酸铜溶液反应时没有氧气参与，但铁原子失去电子、铜离子得到电子，依然属于氧化还原反应。',
        prompt: '判断一个反应是否属于氧化还原反应的本质依据是什么？',
        referenceAnswer: '反应过程中是否发生电子转移（表现为元素化合价发生变化）。',
        correction: '不要局限于“是否与氧气结合”，无氧参与的置换反应同样可以是氧化还原反应。',
        quote: '氧化还原反应的本质是电子转移，外在通常表现为元素化合价的升降。',
      },
      {
        explanation: '失去电子（或化合价升高）的物质发生氧化反应，自身被称为还原剂。',
        example: '在 Zn + Cu²⁺ → Zn²⁺ + Cu 中，Zn 失去电子、化合价由 0 升至 +2，作还原剂。',
        prompt: '物质在反应中失去电子、化合价升高，它发生的是氧化还是还原？它是氧化剂还是还原剂？',
        referenceAnswer: '发生氧化反应，本身作为还原剂。',
        correction: '记住“升失氧化还原剂”：化合价升高、失去电子、被氧化、作还原剂。',
        quote: '失去电子、化合价升高的物质被氧化，在反应中作还原剂。',
      },
      {
        explanation: '氧化反应与还原反应总是同时发生、相互伴随，得失电子总数必然守恒。',
        example: '铜离子得到 2 个电子被还原的同时，必然有金属原子提供这 2 个电子而被氧化。',
        prompt: '一个化学反应里可能只发生氧化反应而不发生还原反应吗？为什么？',
        referenceAnswer: '不可能。因为电子不会凭空产生或消失，有失电子就必定有得电子。',
        correction: '氧化与还原在同一个反应中总是成对出现且得失电子数相等。',
        quote: '在同一个氧化还原反应中，氧化与还原必然同时发生，且得失电子总数相等。',
      },
    ],
  },
];

const storageKey = 'fold:guided-preview:v1';
const unsafeControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const topicPrefix = /^(我刚开始学|零基础学习|零基础学|我想学习|我想学|想学习|想学|学习)/;

interface Attempt {
  id: string;
  item: number;
  opened: boolean;
  draft: string;
  answer?: string | null;
  grade?: 0 | 2;
}

interface Due {
  day: string;
  interval: number;
  reps: number;
  ease: number;
}

interface CustomLessonData {
  title: string;
  overview: string;
  source: GuidedSource;
  items: PreviewItem[];
}

interface PreviewStudy {
  lesson: GuidedRun['lesson'];
  sourceId: string;
  sourceMaterial?: string;
  custom?: CustomLessonData;
  rounds: Attempt[][];
  due: (Due | null)[];
}

interface State {
  modelConfigured: boolean;
  study?: PreviewStudy;
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function changed(): never {
  return fail('study_changed', '学习位置已经变化，请重新打开当前页。');
}

function load(): State {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const state = JSON.parse(raw) as State;
      if (typeof state.modelConfigured === 'boolean') return state;
    }
  } catch {
    // An invalid preview snapshot is treated as a fresh browser session.
  }
  return { modelConfigured: false };
}

function save(state: State) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function extractCustomMaterial(raw: string): string | null {
  const trimmed = raw.trim();
  if (/^自定义[：:]/.test(trimmed)) {
    const body = trimmed.replace(/^自定义[：:]/, '').trim();
    return body || null;
  }
  if ([...trimmed].length >= 40) {
    return trimmed;
  }
  return null;
}

function buildCustomSource(body: string): GuidedSource {
  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? body;
  const title = [...firstLine].slice(0, 18).join('') + ([...firstLine].length > 18 ? '…' : '');
  return {
    id: 'custom-user-source',
    title: `自定义资料：${title}`,
    publisher: '用户自定义资料',
    url: '',
    license: '用户本地粘贴资料 · 仅在确认后发往所选模型',
    scope: '自定义学习片段',
    text: body,
  };
}

function buildCustomPreviewData(source: GuidedSource): CustomLessonData {
  const sentences = source.text
    .split(/(?<=[。！？.!?\n])/)
    .map((part) => part.trim())
    .filter((part) => [...part].length >= 6);
  const pool = sentences.length >= 3
    ? sentences.slice(0, 3)
    : [source.text, source.text, source.text];

  const items: PreviewItem[] = pool.map((quote, idx) => ({
    explanation: `围绕第 ${idx + 1} 段关键表述：「${quote.slice(0, 60)}${quote.length > 60 ? '…' : ''}」提炼核心概念与适用边界。`,
    example: `结合这段原文条件，试着用自己的话举一个具体情形来说明「${quote.slice(0, 24)}」。`,
    prompt: `根据你提供的资料第 ${idx + 1} 点，请复述其中最关键的条件或结论。`,
    referenceAnswer: quote,
    correction: '核对时对照原文逐字表述，避免漏掉限定条件。',
    quote,
  }));

  return {
    title: source.title.replace(/^自定义资料：/, ''),
    overview: '根据你提供的本地资料提炼的 3 个离线回忆要点。',
    source,
    items,
  };
}

function matchingProfile(raw: string): PreviewProfile | undefined {
  const topic = raw.trim();
  const isCustom = Boolean(extractCustomMaterial(topic));
  if (!topic || (!isCustom && ([...topic].length > 80 || /[\n\r\t]/.test(topic))) || unsafeControls.test(topic)) {
    fail('invalid_topic', '请用 1 到 80 个字填写科目，或粘贴 40 字以上学习资料。');
  }
  const normalized = topic
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[。.]$/, '')
    .trimEnd()
    .replace(topicPrefix, '')
    .trimStart()
    .replace(/^python\s*[，,]\s*想弄懂循环$/, 'python 控制流');

  const exact = profiles.find((profile) => profile.aliases.includes(normalized));
  if (exact) return exact;

  return profiles.find((profile) => {
    const haystack = [profile.source.title, profile.source.scope, ...profile.aliases].map((item) => item.toLowerCase());
    return haystack.some((candidate) => candidate.includes(normalized) || normalized.includes(candidate));
  });
}

function sourceView(profile: PreviewProfile): GuidedSource {
  return {
    ...profile.source,
    license: 'Fold 原创事实摘要；链接仅供核对，未收录原文或译文。',
    text: profile.items.map((item) => item.quote).join(''),
  };
}

function itemsOf(study: PreviewStudy): { items: PreviewItem[]; sourceMeta: GuidedSource } {
  if (study.custom) {
    return { items: study.custom.items, sourceMeta: study.custom.source };
  }
  const profile = profiles.find((entry) => entry.source.id === study.sourceId) ?? changed();
  return { items: profile.items, sourceMeta: sourceView(profile) };
}

function currentRound(study: PreviewStudy) {
  return study.rounds.at(-1) ?? changed();
}

function activeAttempt(study: PreviewStudy) {
  return currentRound(study).find((attempt) => attempt.grade === undefined);
}

function addRound(study: PreviewStudy, indices: number[], opened: boolean) {
  const round = study.rounds.length + 1;
  study.rounds.push(indices.map((item) => ({
    id: `${study.lesson.id}:${round}:${item}`,
    item, opened, draft: '',
  })));
}

function localDay(offset = 0) {
  const time = new Date();
  time.setDate(time.getDate() + offset);
  return [
    time.getFullYear(),
    String(time.getMonth() + 1).padStart(2, '0'),
    String(time.getDate()).padStart(2, '0'),
  ].join('-');
}

function updateDue(before: Due | null, grade: 0 | 2): Due {
  const ease = before?.ease ?? 2.5;
  const reps = grade === 0 ? 0 : (before?.reps ?? 0) + 1;
  const interval = reps < 2 ? 1 : reps === 2 ? 3 : Math.min(365, Math.round((before?.interval ?? 1) * ease));
  return { day: localDay(interval), interval, reps, ease: grade === 0 ? Math.max(1.3, ease - 0.2) : ease };
}

function runView(study: PreviewStudy): GuidedRun {
  const { items, sourceMeta } = itemsOf(study);
  const round = currentRound(study);
  const total = round.length;
  const attempt = activeAttempt(study);
  const progress = { lesson: study.lesson, total, current: attempt ? round.indexOf(attempt) + 1 : total };
  if (!attempt) {
    const earliest = study.due.flatMap((due) => due ? [due.day] : []).sort()[0];
    return {
      ...progress,
      stage: 'done',
      completed: total,
      nextDueLabel: earliest === localDay(1) ? '明天' : earliest,
      reviewAvailable: Boolean(earliest && earliest <= localDay()),
    };
  }
  const item = items[attempt.item];
  const evidence = () => ({
    label: `${sourceMeta.publisher} · ${sourceMeta.title}`,
    excerpt: item.quote,
    url: sourceMeta.url || undefined,
    material: study.sourceMaterial ?? sourceMeta.text,
  });
  if (!attempt.opened) {
    return { ...progress, stage: 'read', cardId: attempt.id, explanation: item.explanation, example: item.example, source: evidence() };
  }
  const question = { ...progress, attemptId: attempt.id, prompt: item.prompt };
  if (attempt.answer === undefined) {
    return { ...question, stage: 'question', draft: attempt.draft };
  }
  return {
    ...question,
    stage: 'compare',
    answer: attempt.answer,
    referenceAnswer: item.referenceAnswer,
    correction: item.correction,
    source: evidence(),
  };
}

export const guidedMock: GuidedStudyApi = {
  async status() {
    const state = load();
    return { modelConfigured: state.modelConfigured, run: state.study ? runView(state.study) : null };
  },
  async saveKey(apiKey) {
    if (apiKey !== '') fail('preview_key', '浏览器预览无需提供 API Key。');
    save({ ...load(), modelConfigured: true });
    return { balanceAvailable: true };
  },
  async findSources(topic) {
    const customBody = extractCustomMaterial(topic);
    if (customBody) {
      return [buildCustomSource(customBody)];
    }
    const profile = matchingProfile(topic);
    return profile ? [sourceView(profile)] : [];
  },
  async generate({ topic, sourceIds, cloudAck }) {
    if (cloudAck !== true) fail('cloud_ack_required', '请先同意发送范围。');
    const state = load();
    if (!state.modelConfigured) fail('model_not_configured', '请先模拟连接 AI。');

    const customBody = extractCustomMaterial(topic);
    if (customBody) {
      const source = buildCustomSource(customBody);
      if (sourceIds.length !== 1 || sourceIds[0] !== source.id) {
        fail('invalid_sources', '所选资料与当前专题不匹配，请重新选择。');
      }
      const custom = buildCustomPreviewData(source);
      const study: PreviewStudy = {
        lesson: {
          id: `preview-custom-${Date.now()}`,
          title: custom.title,
          topic: topic.trim(),
          overview: custom.overview,
        },
        sourceId: source.id,
        sourceMaterial: source.text,
        custom,
        rounds: [],
        due: custom.items.map(() => null),
      };
      addRound(study, custom.items.map((_, index) => index), false);
      save({ ...state, study });
      return runView(study);
    }

    const profile = matchingProfile(topic);
    if (!profile) fail('no_sources', '暂未找到能核对的资料。');
    if (sourceIds.length !== 1 || sourceIds[0] !== profile.source.id) {
      fail('invalid_sources', '所选资料与当前专题不匹配，请重新选择。');
    }
    const study: PreviewStudy = {
      lesson: {
        id: `preview-${profile.source.id}-${Date.now()}`,
        title: profile.source.scope,
        topic: topic.trim(),
        overview: profile.overview,
      },
      sourceId: profile.source.id,
      sourceMaterial: sourceView(profile).text,
      rounds: [],
      due: profile.items.map(() => null),
    };
    addRound(study, profile.items.map((_, index) => index), false);
    save({ ...state, study });
    return runView(study);
  },
  async reset() {
    const state = load();
    const next: State = { modelConfigured: state.modelConfigured };
    save(next);
    return { modelConfigured: next.modelConfigured, run: null };
  },
  async getRun() {
    const { study } = load();
    return study ? runView(study) : null;
  },
  async startQuestion(lessonId, cardId) {
    const state = load();
    const study = state.study ?? changed();
    const attempt = activeAttempt(study);
    if (study.lesson.id !== lessonId || attempt?.id !== cardId) changed();
    attempt.opened = true;
    save(state);
    return runView(study);
  },
  async saveDraft({ attemptId, draft }) {
    if ([...draft].length > 2500) fail('answer_too_long', '答案不能超过 2500 个字。');
    const state = load();
    const attempt = state.study && activeAttempt(state.study);
    if (attempt?.id !== attemptId || !attempt.opened || attempt.answer !== undefined) return;
    attempt.draft = draft;
    save(state);
  },
  async submitAnswer({ attemptId, answer }) {
    const state = load();
    const study = state.study ?? changed();
    const attempt = activeAttempt(study);
    if (attempt?.id !== attemptId) changed();
    const value = answer === null ? null : answer.trim();
    if (value !== null && (!value || [...value].length > 2500 || unsafeControls.test(value))) {
      fail('bad_answer', '请写下答案，或选择「想不起来」。');
    }
    if (!attempt.opened || (attempt.answer !== undefined && attempt.answer !== value)) {
      fail('answer_locked', '首次作答已保存或题目尚未打开，不能改写。');
    }
    if (attempt.answer === undefined) {
      attempt.answer = value;
      attempt.draft = '';
      save(state);
    }
    return runView(study);
  },
  async confirmAnswer({ attemptId, grade }) {
    if (grade !== 0 && grade !== 2) fail('invalid_rating', '请选择是否需要再练。');
    const state = load();
    const study = state.study ?? changed();
    const attempt = study.rounds.flat().find((entry) => entry.id === attemptId) ?? changed();
    if (attempt.grade === grade) return runView(study);
    if (attempt !== activeAttempt(study) || attempt.answer === undefined || (attempt.answer === null && grade !== 0)) {
      changed();
    }
    attempt.grade = grade;
    study.due[attempt.item] = updateDue(study.due[attempt.item], grade);
    save(state);
    return runView(study);
  },
  async beginReview(lessonId) {
    const state = load();
    const study = state.study ?? changed();
    if (study.lesson.id !== lessonId) changed();
    if (!activeAttempt(study)) {
      const today = localDay();
      const due = study.due
        .flatMap((entry, index) => entry && entry.day <= today ? [{ day: entry.day, index }] : [])
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((entry) => entry.index);
      if (due.length) {
        addRound(study, due, true);
        save(state);
      }
    }
    return runView(study);
  },
};
