import { expect, test, type Page } from '@playwright/test';

const categoryList = (page: Page) => page.getByRole('tablist', { name: '设置分类' });
const category = (page: Page, name: string) => categoryList(page).getByRole('tab', { name, exact: true });
const panel = (page: Page, name: string) => page.getByRole('tabpanel', { name, exact: true });
const settingsButton = (page: Page) => page.getByRole('banner').getByRole('button', { name: '设置', exact: true });

async function openSettings(page: Page) {
  await page.goto('/?legacy=1');
  await settingsButton(page).click();
  await expect(category(page, '学习')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, '学习')).toBeVisible();
}

test('settings categories support keyboard navigation and retain an unsaved draft', async ({ page }) => {
  await openSettings(page);

  await expect(categoryList(page).getByRole('tab')).toHaveCount(5);
  await expect(categoryList(page).locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  const learning = category(page, '学习');
  await expect(learning).toHaveAttribute('tabindex', '0');

  const timezone = panel(page, '学习').getByRole('combobox');
  await timezone.selectOption('Asia/Tokyo');

  await learning.focus();
  await page.keyboard.press('ArrowRight');
  await expect(category(page, '外观')).toBeFocused();
  await page.keyboard.press('End');
  await expect(category(page, '隐私')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(category(page, '模型')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(category(page, '隐私')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(category(page, '隐私')).toHaveAttribute('aria-selected', 'true');
  await expect(panel(page, '隐私')).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);

  await learning.click();
  await expect(timezone).toHaveValue('Asia/Tokyo');
});

test('short settings panels keep actions reachable and honor reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openSettings(page);

  const save = panel(page, '学习').getByRole('button', { name: '保存学习设置' });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();

  await page.setViewportSize({ width: 360, height: 480 });
  await category(page, '数据').click();
  const data = panel(page, '数据');
  await expect(data).toBeVisible();
  expect(await data.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

  const durations = await data.evaluate((element) => {
    const times = (value: string) => value.split(',').map((time) => {
      const trimmed = time.trim();
      return parseFloat(trimmed) * (trimmed.endsWith('ms') ? 1 : 1000);
    });
    const durations: number[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      durations.push(...times(style.animationDuration), ...times(style.transitionDuration));
      if (node.classList.contains('settings-screen')) break;
    }
    return durations;
  });
  expect(Math.max(...durations)).toBeLessThanOrEqual(1);

  const backup = data.getByRole('button', { name: '备份数据库' });
  await backup.scrollIntoViewIfNeeded();
  await expect(backup).toBeInViewport();
  await backup.click({ trial: true });
});

test('appearance follows the titlebar and stays saved after learning settings and reload', async ({ page }) => {
  await openSettings(page);
  const root = page.locator('html');
  const paper = panel(page, '外观').getByRole('radio', { name: '纸色', exact: true });
  const ink = panel(page, '外观').getByRole('radio', { name: '墨色', exact: true });

  await category(page, '外观').click();
  await expect(ink).toBeChecked();
  await page.getByRole('button', { name: '换成纸色' }).click();
  await expect(paper).toBeChecked();
  await expect(root).toHaveAttribute('data-theme', 'paper');

  await category(page, '学习').click();
  const timezone = panel(page, '学习').getByRole('combobox');
  await timezone.selectOption('Asia/Tokyo');
  await panel(page, '学习').getByRole('button', { name: '保存学习设置' }).click();
  await expect(page.getByText('学习设置已保存', { exact: true })).toBeVisible();
  await expect(root).toHaveAttribute('data-theme', 'paper');

  await page.reload();
  await settingsButton(page).click();
  await expect(root).toHaveAttribute('data-theme', 'paper');
  await expect(timezone).toHaveValue('Asia/Tokyo');
  await category(page, '外观').click();
  await expect(paper).toBeChecked();
  await ink.press('Space');
  await expect(ink).toBeChecked();
  await expect(root).toHaveAttribute('data-theme', 'ink');
});

test('the settings API guide returns to the disabled browser model controls without a network request', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    external.push(url.origin);
    return route.abort();
  });

  await openSettings(page);
  await category(page, '模型').click();
  const model = panel(page, '模型');
  await model.getByRole('button', { name: '获取 DeepSeek API Key' }).click();
  const guide = page.getByRole('dialog', { name: '获取 DeepSeek API Key' });
  await guide.getByRole('button', { name: '下一步' }).click();
  await guide.getByRole('button', { name: '下一步' }).click();
  await guide.getByRole('button', { name: '查看设置预览' }).click();

  await expect(guide).toHaveCount(0);
  await expect(category(page, '模型')).toHaveAttribute('aria-selected', 'true');
  await expect(model).toHaveAttribute('id', 'settings-model');
  await expect(model.locator('input[type=password]')).toBeDisabled();
  await expect(model.getByRole('button', { name: '保存并测试' })).toBeDisabled();
  await model.getByRole('button', { name: '高级设置', exact: true }).click();
  await expect(model.getByPlaceholder('deepseek-flash')).toBeVisible();
  expect(external).toEqual([]);
});
