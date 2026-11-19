import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const fixtureId = 'test-only-native-smoke';
const sourceId = 'test-only-local-facts';
const runId = `${fixtureId}-run`;
const pastDate = '2000-01-01';
export const lessonTitle = 'TEST-ONLY 原生续学验收';
export const firstAnswer = '40 度，与入射角相等。';

const items = [
  {
    explanation: '入射角和反射角都以法线为基准，并且大小相等。',
    example: '以法线为基准，入射角是 30 度，反射角也是 30 度。',
    question: '入射角是 40 度时，反射角是多少？',
    answer: '反射角是 40 度。',
    correction: '先从法线判断角的大小，再取相等的角度。',
    quote: '反射角与入射角相等。',
  },
  {
    explanation: '法线通过入射点，并与反射面垂直。',
    example: '水平方向的镜面上，入射点的法线是竖直方向。',
    question: '在水平面上画出的法线是什么方向？',
    answer: '法线为竖直方向。',
    correction: '法线和镜面垂直，而不是平行。',
    quote: '法线在入射点垂直于反射面。',
  },
  {
    explanation: '当光线沿法线照向镜面时，入射角及反射角均为零。',
    example: '从镜面正上方直射的光沿原路返回。',
    question: '沿法线正对镜面入射时，反射角是多少？',
    answer: '反射角是零度。',
    correction: '角度从法线量起，沿法线入射恰好为零。',
    quote: '光沿法线入射时，入射角和反射角均为零。',
  },
];

// Called only after the smoke's first isolated EXE process initializes and exits.
export function installNativeStudyFixture(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    assert.equal(db.prepare('SELECT count(*) AS total FROM guided_lesson').get().total, 0);
    db.prepare('INSERT INTO guided_lesson(id, topic, title, overview) VALUES (?, ?, ?, ?)')
      .run(fixtureId, '仅用于测试的光学事实', lessonTitle, '检验 Windows 离线学习、草稿恢复和复习排期。');
    db.prepare(`INSERT INTO guided_source
      (lesson_id, id, title, publisher, url, license, scope, material) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(fixtureId, sourceId, '测试专用事实', 'TEST-ONLY', 'https://example.invalid/fold-test-only',
        '仅用于测试', '光的反射', items.map((item) => item.quote).join('\n'));
    db.prepare('INSERT INTO guided_run(id, lesson_id, started_at) VALUES (?, ?, ?)')
      .run(runId, fixtureId, new Date().toISOString());
    const insertItem = db.prepare(`INSERT INTO guided_item
      (id, lesson_id, position, explanation, example, question, answer, correction, source_id, quote)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertAttempt = db.prepare('INSERT INTO guided_attempt(id, run_id, item_id, position) VALUES (?, ?, ?, ?)');
    for (const [position, item] of items.entries()) {
      const itemId = `${fixtureId}-item-${position}`;
      insertItem.run(itemId, fixtureId, position, item.explanation, item.example, item.question,
        item.answer, item.correction, sourceId, item.quote);
      insertAttempt.run(`${fixtureId}-attempt-${position}`, runId, itemId, position);
    }
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}

export function verifyNativeStudyFixture(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const attempts = db.prepare(`SELECT a.answer, a.draft, a.grade, a.confirmed_at, i.due_on
      FROM guided_attempt a JOIN guided_item i ON i.id = a.item_id
      WHERE a.run_id = ? ORDER BY a.position`).all(runId);
    assert.deepEqual(attempts.map(({ grade }) => grade), [2, 0, 0]);
    assert.deepEqual(attempts.map(({ answer }) => answer), [firstAnswer, null, null]);
    for (const attempt of attempts) {
      assert.equal(attempt.draft, '');
      assert.ok(attempt.confirmed_at);
      assert.match(attempt.due_on, /^\d{4}-\d{2}-\d{2}$/);
    }
  } finally {
    db.close();
  }
}

// Backdate one completed fixture item without changing the system clock or other items.
export function makeNativeReviewDue(file) {
  const db = new DatabaseSync(file);
  try {
    const { changes } = db.prepare(`UPDATE guided_item SET due_on = ?
      WHERE lesson_id = ? AND position = 0 AND due_on IS NOT NULL`).run(pastDate, fixtureId);
    assert.equal(changes, 1);
  } finally {
    db.close();
  }
}

export function verifyNativeReviewFixture(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const attempts = db.prepare(`SELECT i.position, a.answer, a.grade, a.confirmed_at, i.due_on
      FROM guided_attempt a JOIN guided_item i ON i.id = a.item_id
      WHERE i.lesson_id = ? AND a.run_id <> ?`).all(fixtureId, runId);
    assert.equal(attempts.length, 1);
    const [review] = attempts;
    assert.equal(review.position, 0);
    assert.equal(review.answer, firstAnswer);
    assert.equal(review.grade, 2);
    assert.ok(review.confirmed_at);
    assert.match(review.due_on, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(review.due_on > pastDate);
  } finally {
    db.close();
  }
}
