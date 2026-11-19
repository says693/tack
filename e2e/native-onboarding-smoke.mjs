import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import {
  firstAnswer,
  installNativeStudyFixture,
  lessonTitle,
  makeNativeReviewDue,
  verifyNativeReviewFixture,
  verifyNativeStudyFixture,
} from './native-study-fixture.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const executable = process.env.FOLD_NATIVE_EXE
  ? resolve(process.env.FOLD_NATIVE_EXE)
  : join(project, 'src-tauri', 'target', 'release', 'fold.exe');
const output = process.argv[2]
  ? resolve(process.argv[2])
  : join(project, 'test-results', 'native-onboarding.png');
const compactOutput = process.argv[3] ? resolve(process.argv[3]) : null;
const host = '127.0.0.1';
const nativeHosts = new Set(['tauri.localhost', 'ipc.localhost', 'asset.localhost']);

async function listenLoopback(server) {
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, host, done);
  });
  return server.address().port;
}

function closeServer(server) {
  return new Promise((done) => server.close(done));
}

function isNativePage(url) {
  return url.hostname === 'tauri.localhost' || url.protocol === 'tauri:';
}

function externalOrigin(raw) {
  const url = new URL(raw);
  return /^https?:$/.test(url.protocol) && !nativeHosts.has(url.hostname) ? url.origin : null;
}

async function waitForCDP(endpoint, processFailure) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (processFailure.value) throw processFailure.value;
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(500) });
      if (response.ok && (await response.json()).webSocketDebuggerUrl) return;
    } catch {
      // WebView2 may still be starting.
    }
    await delay(200);
  }
  throw new Error('WebView2 did not expose CDP on the reserved loopback port.');
}

async function withApp(scratch, phase, verify) {
  const dataDir = join(scratch, 'app-data');
  const userData = join(scratch, `webview-${phase}`);
  const rejectExternal = createServer((socket) => socket.destroy());
  const portLease = createServer();
  let child;
  let childExited;
  let browser;
  let stderr = '';

  try {
    await mkdir(userData);
    const proxyPort = await listenLoopback(rejectExternal);
    const debugPort = await listenLoopback(portLease);
    const endpoint = `http://${host}:${debugPort}`;
    const overrides = {
      FOLD_DATA_DIR: dataDir,
      WEBVIEW2_USER_DATA_FOLDER: userData,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: [
        `--remote-debugging-address=${host}`,
        `--remote-debugging-port=${debugPort}`,
        `--proxy-server=http://${host}:${proxyPort}`,
        '--proxy-bypass-list=tauri.localhost;ipc.localhost;asset.localhost',
      ].join(' '),
    };
    const env = Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !Object.hasOwn(overrides, key.toUpperCase())));
    await closeServer(portLease);
    child = spawn(executable, [], {
      cwd: dirname(executable),
      env: { ...env, ...overrides },
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const processFailure = { value: null };
    child.stderr.setEncoding('utf8').on('data', (text) => { stderr = (stderr + text).slice(-2000); });
    childExited = new Promise((done) => {
      child.once('error', (error) => { processFailure.value = error; done(); });
      child.once('exit', (code, signal) => {
        processFailure.value = new Error(`Fold exited before the smoke completed (${code ?? signal}).`);
        done();
      });
    });
    await waitForCDP(endpoint, processFailure);
    browser = await chromium.connectOverCDP(endpoint, { timeout: 10_000 });
    const [context] = browser.contexts();
    if (!context) throw new Error('WebView2 did not expose its browser context.');
    const external = new Set();
    await context.route('**/*', (route) => {
      const origin = externalOrigin(route.request().url());
      if (!origin) return route.continue();
      external.add(origin);
      return route.abort();
    });
    const page = context.pages().find((candidate) => isNativePage(new URL(candidate.url())))
      ?? context.pages()[0] ?? await context.waitForEvent('page', { timeout: 10_000 });
    await page.waitForURL(isNativePage, { timeout: 10_000 });

    await verify(page);

    // The isolated proxy blocks external WebView traffic before CDP attaches as well.
    for (const resource of await page.evaluate(() => performance.getEntriesByType('resource').map(({ name }) => name))) {
      const origin = externalOrigin(resource);
      if (origin) external.add(origin);
    }
    expect([...external], `App page must not request external resources during ${phase}`).toEqual([]);
  } catch (error) {
    if (stderr.trim()) console.error(stderr.trim());
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    if (child && child.exitCode === null && child.signalCode === null) child.kill();
    const exited = !childExited || await Promise.race([
      childExited.then(() => true), delay(5000, false, { ref: false }),
    ]);
    if (portLease.listening) await closeServer(portLease);
    if (rejectExternal.listening) await closeServer(rejectExternal);
    if (!exited) throw new Error(`Fold did not stop after the ${phase} smoke.`);
  }
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true });
const answer = (page) => page.getByRole('textbox', { name: '你的答案', exact: true });

async function capture(page, file) {
  await page.evaluate(() => document.fonts.ready);
  await mkdir(dirname(file), { recursive: true });
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', timeout: 10_000 });
}

async function firstRun(page) {
  const connect = heading(page, '连接 AI');
  const key = page.getByLabel('DeepSeek API Key', { exact: true });
  await expect(connect).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.app-root')).toHaveAttribute('data-view', 'onboarding');
  await expect(key).toBeVisible();
  await expect(key).toHaveAttribute('type', 'password');
  await expect(key).toHaveValue('');
  await expect(button(page, '连接并测试')).toBeDisabled();
  await expect(button(page, '在浏览器模拟连接')).toHaveCount(0);

  await button(page, '获取 DeepSeek API Key').click();
  const guide = page.getByRole('dialog', { name: '获取 DeepSeek API Key' });
  const screenshotLoaded = (file) => guide.locator(`img[src$="${file}"]`)
    .evaluate((node) => node.complete && node.naturalWidth > 0);
  await expect.poll(() => screenshotLoaded('deepseek-official.webp')).toBe(true);
  await expect(button(guide, '打开官方 API Keys 页面')).toBeVisible();
  await expect(button(guide, '打开官方文档')).toBeVisible();
  await button(guide, '下一步').click();
  await expect(button(guide, '打开官方 API Keys 页面')).toBeVisible();
  await button(guide, '下一步').click();
  await expect.poll(() => screenshotLoaded('deepseek-fold-connect.webp')).toBe(true);
  await button(guide, '返回连接 AI').click();
  await expect(guide).toHaveCount(0);
  await expect(connect).toBeVisible();
  await expect(key).toBeFocused();
  await expect(key).toHaveValue('');

  await connect.focus();
  await capture(page, output);
  if (compactOutput) {
    await page.setViewportSize({ width: 360, height: 640 });
    await expect(key).toBeInViewport();
    await expect(button(page, '获取 DeepSeek API Key')).toBeInViewport();
    await capture(page, compactOutput);
  }
}

async function expectStudy(page) {
  await expect(heading(page, lessonTitle)).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.app-root')).toHaveAttribute('data-view', 'study');
  await expect(page.locator('input[type=password]')).toHaveCount(0);
}

async function startStudy(page) {
  await expectStudy(page);
  await expect(heading(page, '讲解')).toBeVisible();
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
  await button(page, '答一题').click();
  await expect(button(page, '看答案')).toBeDisabled();
  await answer(page).fill(firstAnswer);
  await expect(page.getByRole('status').filter({ hasText: '草稿已保存' })).toBeVisible();
}

async function resumeStudy(page) {
  await expectStudy(page);
  await expect(answer(page)).toHaveValue(firstAnswer);
  await expect(page.getByText('参考答案', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('完整本地笔记')).toHaveCount(0);
  await button(page, '看答案').click();
  await expect(heading(page, '核对答案')).toBeVisible();
  await expect(page.getByText(firstAnswer, { exact: true })).toBeVisible();
  await page.getByText('资料出处', { exact: true }).click();
  await expect(page.getByText('反射角与入射角相等。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('完整本地笔记')).toContainText('法线在入射点垂直于反射面。');
  await button(page, '我答对了').click();
  for (const item of [2, 3]) {
    await expect(page.getByText(`${item} / 3`, { exact: true })).toBeVisible();
    await button(page, '答一题').click();
    await button(page, '想不起来').click();
    await button(page, '下次再练').click();
  }
  await expect(heading(page, '本节完成')).toBeVisible();
  await expect(page.getByText('已保存 3 题', { exact: true })).toBeVisible();
  await expect(page.getByText(/^下次复习：/)).toBeVisible();
}

async function reviewDueItem(page) {
  await expectStudy(page);
  await expect(heading(page, '本节完成')).toBeVisible();
  await button(page, '开始复习').click();
  await expect(page.getByText('1 / 1', { exact: true })).toBeVisible();
  await expect(answer(page)).toHaveValue('');
  await answer(page).fill(firstAnswer);
  await button(page, '看答案').click();
  await expect(page.getByText('反射角是 40 度。', { exact: true })).toBeVisible();
  await button(page, '我答对了').click();
  await expect(page.getByText('已保存 1 题', { exact: true })).toBeVisible();
  await expect(button(page, '开始复习')).toHaveCount(0);
}

async function smoke() {
  const images = compactOutput ? [output, compactOutput] : [output];
  if (process.platform !== 'win32' || process.argv.length > 4 || !/\.exe$/i.test(executable)
      || images.some((file) => !/\.png$/i.test(file)) || compactOutput?.toLowerCase() === output.toLowerCase()) {
    throw new Error('Usage on Windows: node e2e/native-onboarding-smoke.mjs [screenshot.png [compact.png]]');
  }
  await access(executable);
  const tempRoot = await realpath(tmpdir());
  const scratch = await mkdtemp(join(tempRoot, 'fold-native-smoke-'));
  const dbFile = join(scratch, 'app-data', 'fold.db');
  try {
    await withApp(scratch, 'onboarding', firstRun);
    await access(dbFile);
    installNativeStudyFixture(dbFile);
    await withApp(scratch, 'study', startStudy);
    await withApp(scratch, 'resume', resumeStudy);
    verifyNativeStudyFixture(dbFile);
    makeNativeReviewDue(dbFile);
    await withApp(scratch, 'review', reviewDueItem);
    verifyNativeStudyFixture(dbFile);
    verifyNativeReviewFixture(dbFile);
    console.log(`Native onboarding and offline TEST-ONLY study smoke passed. Screenshot: ${output}`);
    if (compactOutput) console.log(`Compact WebView screenshot (360 x 640 CSS viewport): ${compactOutput}`);
  } finally {
    if (dirname(scratch) === tempRoot && await realpath(scratch) === scratch) {
      await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}

await smoke();
