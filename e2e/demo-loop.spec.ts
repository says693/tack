import { test, expect } from '@playwright/test';

test('legacy browser fixture supports a confirmed review', async ({ page }) => {
  await page.goto('/?legacy=1');

  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation.getByRole('button', { name: '书架', exact: true })).toBeVisible();

  await navigation.getByRole('button', { name: /^复习/ }).click();
  await expect(page.locator('.question-text')).toBeVisible();
  await expect(page.locator('.question-text')).not.toBeEmpty();

  await page.locator('.answer-panel textarea').fill('登记完成后。');
  await page.getByRole('button', { name: /提交作答|保存并自评/ }).click();

  const saved = page.locator('.answer-saved');
  const consent = page.getByRole('button', { name: '我已知晓，继续' });
  await expect(saved.or(consent)).toBeVisible();
  if (await consent.isVisible()) {
    await consent.click();
  }
  await expect(saved).toBeVisible();
  await expect(page.getByText('这次由你决定评级')).toBeVisible();

  await page.locator('.grade-option').nth(2).click();
  await page.getByRole('button', { name: /确认评级并排期/ }).click();

  await expect(page.getByText('这一页折好了。')).toBeVisible();
  await expect(page.locator('.result-due')).toContainText('下次复习');
  await expect(page.locator('.result-copy')).toContainText('评级 2');
});
