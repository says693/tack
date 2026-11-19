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

interface PreviewStudy {
  lesson: GuidedRun['lesson'];
  sourceId: string;
  sourceMaterial?: string;
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

function matchingProfile(raw: string) {
  const topic = raw.trim();
  if (!topic || [...topic].length > 80 || /[\n\r\t]/.test(topic) || unsafeControls.test(topic)) {
    fail('invalid_topic', '请用 1 到 80 个字填写一个想学的科目。');
  }
  const normalized = topic
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[。.]$/, '')
    .trimEnd()
    .replace(topicPrefix, '')
    .trimStart()
    .replace(/^python\s*[，,]\s*想弄懂循环$/, 'python 控制流');
  return profiles.find((profile) => profile.aliases.includes(normalized));
}

function sourceView(profile: PreviewProfile): GuidedSource {
  return {
    ...profile.source,
    license: 'Fold 原创事实摘要；链接仅供核对，未收录原文或译文。',
    text: profile.items.map((item) => item.quote).join(''),
  };
}

function profileOf(study: PreviewStudy) {
  return profiles.find((profile) => profile.source.id === study.sourceId) ?? changed();
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
  const profile = profileOf(study);
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
  const item = profile.items[attempt.item];
  const evidence = () => ({
    label: `${profile.source.publisher} · ${profile.source.title}`,
    excerpt: item.quote,
    url: profile.source.url,
    material: study.sourceMaterial ?? sourceView(profile).text,
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
    const profile = matchingProfile(topic);
    return profile ? [sourceView(profile)] : [];
  },
  async generate({ topic, sourceIds, cloudAck }) {
    if (cloudAck !== true) fail('cloud_ack_required', '请先同意发送范围。');
    const profile = matchingProfile(topic);
    if (!profile) fail('no_sources', '暂未找到能核对的资料。');
    if (sourceIds.length !== 1 || sourceIds[0] !== profile.source.id) {
      fail('invalid_sources', '所选资料与当前专题不匹配，请重新选择。');
    }
    const state = load();
    if (!state.modelConfigured) fail('model_not_configured', '请先模拟连接 AI。');
    if (state.study) {
      if (state.study.lesson.topic === topic.trim()) return runView(state.study);
      fail('lesson_already_exists', '已准备好一节课程，请继续当前学习。');
    }
    const study: PreviewStudy = {
      lesson: {
        id: `preview-${profile.source.id}`,
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
