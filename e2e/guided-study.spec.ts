import { expect, test, type Locator, type Page } from '@playwright/test';

async function restrictToPreview(page: Page) {
  const external: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();
    if (url.origin === 'http://127.0.0.1:4173') return route.continue();
    external.push(url.origin);
    return route.abort();
  });
  return external;
}

function topicInput(page: Page) {
  return page.getByRole('textbox', { name: '想学的内容', exact: true });
}

async function connectInPreview(page: Page) {
  await page.getByRole('button', { name: '在浏览器模拟连接', exact: true }).click();
  await expect(topicInput(page)).toBeVisible();
}

async function reopenAt(page: Page, stage: Locator) {
  await page.reload();
  const resume = page.getByRole('button', { name: '继续学习', exact: true });
  await expect(stage.or(resume).first()).toBeVisible();
  if (await resume.isVisible()) await resume.click();
  await expect(stage).toBeVisible();
}

test('guided preview uses a verified source fixture, then resumes local study', async ({ page }) => {
  const external = await restrictToPreview(page);
  await page.goto('/?guided=1');

  await expect(page.getByRole('heading', { name: '连接 AI', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '开始离线试学', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '光的反射', exact: true })).toHaveCount(0);
  await expect(page.locator('input[type=password]')).toHaveCount(0);

  await connectInPreview(page);
  await topicInput(page).fill('光的反射');
  await page.getByRole('button', { name: '查找资料', exact: true }).click();

  await expect(page.getByRole('heading', { name: '确认资料与发送范围', exact: true })).toBeVisible();
  const source = page.getByRole('checkbox', { name: /光的反射：反射定律/ });
  const generate = page.getByRole('button', { name: '同意并生成首节', exact: true });
  await expect(source).toBeChecked();
  await expect(page.getByText(/NASA Science/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '首节已准备好' })).toHaveCount(0);
  await page.getByText('预览资料', { exact: true }).first().click();
  await expect(page.getByText(/反射角等于入射角。/).first()).toBeVisible();
  await source.uncheck();
  await expect(generate).toBeDisabled();
  await source.check();
  await generate.click();

  await expect(page.getByRole('heading', { name: '首节已准备好', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '开始学习', exact: true }).click();
  await page.getByRole('button', { name: '答一题', exact: true }).click();

  const answer = page.getByRole('textbox', { name: '你的答案', exact: true });
  const reveal = page.getByRole('button', { name: '看答案', exact: true });
  const reference = page.getByText('参考答案', { exact: true });
  const firstAnswer = '反射光线和入射光线与法线的夹角相等';
  await expect(reference).toHaveCount(0);
  await expect(reveal).toBeDisabled();
  await answer.fill(firstAnswer);
  await expect(page.getByRole('status').filter({ hasText: '草稿已保存' })).toBeVisible();
  await reopenAt(page, answer);
  await expect(answer).toHaveValue(firstAnswer);
  await expect(reference).toHaveCount(0);
  await reveal.click();

  await expect(reference).toBeVisible();
  await reopenAt(page, reference);
  await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '我答对了', exact: true }).click();
  const explanation = page.getByRole('heading', { name: '讲解', exact: true });
  await expect(explanation).toBeVisible();
  await reopenAt(page, explanation);
  for (const card of [2, 3]) {
    await expect(page.getByText(`${card} / 3`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '答一题', exact: true }).click();
    await page.getByRole('button', { name: '想不起来', exact: true }).click();
    await expect(reference).toBeVisible();
    await page.getByRole('button', { name: '下次再练', exact: true }).click();
  }
  const complete = page.getByRole('heading', { name: '本节完成', exact: true });
  await expect(complete).toBeVisible();
  await reopenAt(page, complete);
  await expect(page.getByText('已保存 3 题', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '我答对了', exact: true })).toHaveCount(0);
  expect(external).toEqual([]);
});

test('unsupported topic offers no generation or outbound request', async ({ page }) => {
  const external = await restrictToPreview(page);
  await page.goto('/?guided=1');
  await connectInPreview(page);
  await topicInput(page).fill('挪威语古诗格律');
  await page.getByRole('button', { name: '查找资料', exact: true }).click();

  await expect(page.getByText(/暂未找到能核对的资料/)).toBeVisible();
  await expect(topicInput(page)).toHaveValue('挪威语古诗格律');
  await expect(page.getByRole('button', { name: '同意并生成首节', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '正在生成首节' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '首节已准备好' })).toHaveCount(0);
  expect(external).toEqual([]);
});
