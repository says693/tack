import { expect, test } from '@playwright/test';

test('narrow first-run guide loads local screenshots and returns to the connection step', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const external: string[] = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173' || !/^https?:$/.test(url.protocol)) return route.continue();
    external.push(url.origin);
    return route.abort();
  });

  await page.goto('/');
  const heading = page.getByRole('heading', { name: '连接 AI', exact: true });
  const openGuide = page.getByRole('button', { name: '获取 DeepSeek API Key', exact: true });
  await expect(heading).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始离线试学', exact: true })).toHaveCount(0);
  const connect = page.getByRole('button', { name: '在浏览器模拟连接', exact: true });

  await openGuide.click();
  const dialog = page.getByRole('dialog', { name: '获取 DeepSeek API Key' });
  const screenshotLoaded = (file: string) => dialog.locator(`img[src$="${file}"]`)
    .evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0);
  await expect.poll(() => screenshotLoaded('deepseek-official.webp')).toBe(true);
  await expect(dialog.getByRole('button', { name: '打开官方 API Keys 页面' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '打开官方文档' })).toBeVisible();
  await dialog.getByRole('button', { name: '下一步' }).click();
  await expect(dialog.getByRole('button', { name: '打开官方 API Keys 页面' })).toBeVisible();
  await dialog.getByRole('button', { name: '下一步' }).click();
  await expect.poll(() => screenshotLoaded('deepseek-fold-connect.webp')).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dialog.getByRole('button', { name: '返回连接 AI', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(heading).toBeVisible();
  await expect(connect).toBeFocused();

  await openGuide.click();
  await expect(dialog.getByRole('heading', { name: '打开 DeepSeek 官方入口', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(connect).toBeVisible();
  expect(external).toEqual([]);
});
