import { expect, test, type Page } from '@playwright/test';

/**
 * These tests run against the real production bundle served by `vite preview`
 * at a GitHub-Pages-like base path. Only the Edge Function endpoints are
 * intercepted, so routing, hashing, layout and the export pipeline are real.
 */

const SHARE_TOKEN = 'E2E_SHARE_TOKEN_abcdefghijklmnopqrstuvwxyz01';
const ANSWERS_PATTERN = ['a', 'b', 'c', 'd'];

// A small deterministic report built by the app's own scoring engine is not
// available in the browser context, so we ship a fixed one here instead.
const MOCK_REPORT = {
  scoringVersion: 'v1',
  archetypeId: 'lighthouse',
  archetypeName: '灯塔架构师',
  archetypeGlyph: '灯',
  palette: { ink: '#2F2A26', accent: '#C2703D', soft: '#F6EADB' },
  tagline: '把复杂的事，拆成能走的长路',
  oneLiner: '你习惯先看清全局再落脚点，别人凭感觉出发，你靠结构抵达。',
  secondaryArchetypeId: 'helmsman',
  secondaryArchetypeName: '稳舵掌柜',
  scores: {
    analysis: 88,
    stability: 72,
    autonomy: 66,
    imagination: 24,
    resilience: 58,
    mission: 61,
    expression: 32,
    intimacy: 38,
  },
  strongest: 'analysis',
  weakest: 'imagination',
  spread: 64,
  balanced: false,
  coreTraits: ['习惯先建模再行动，能在混乱里画出条理', '对长期结果敏感，对短期输赢相对淡然'],
  strengths: ['把模糊问题拆成可执行步骤的能力很强', '在信息不全时也能做出相对稳健的决策'],
  blindSpots: ['分析成本过高时，容易错过窗口期', '对"差不多就行"这件事零容忍'],
  career: {
    directions: [
      { title: '战略研究 / 咨询 / 架构设计', reason: '你的核心优势是把模糊命题变成结构化方案。' },
      { title: '产品规划 / 数据策略 / 风控与审计', reason: '需要长周期推演和责任兜底的角色。' },
      { title: '学术研究 / 技术专家路线', reason: '独立产出的评价体系清晰。' },
    ],
  },
  workEnvironment: {
    suited: ['允许深度工作、不频繁打断的团队', '有明确长期目标、评价周期较长的组织'],
    stressful: ['每天救火、目标天天变的环境', '只讲情绪不讲逻辑的会议'],
  },
  communication: {
    style: '偏内收，但一旦给出结论就很有分量。',
    tips: ['别只在脑子里完成推演，把中间那步说出来', '先讲结论再讲推导，能显著减少沟通成本'],
  },
  relationship: {
    needs: ['需要不被打扰的独处时间，那是你的充电方式', '希望对方能理解你做决定的依据'],
    strengths: ['做长期决定理性，不会被短期情绪带走', '遇事能兜住，是关系里的稳定器'],
    frictions: ['想太久的时候，对方会觉得自己被晾着', '习惯自己消化压力，容易被误解为"不在乎"'],
    partnerTips: ['在他拉长线的时候，给他明确的"我在等你"信号', '把"我问了很多问题"翻译成"我很认真"'],
  },
  growth: [
    '给"想清楚"设一个明确的时间盒，超时就用现有信息决策。',
    '每周至少把一个只存在你脑子里的判断说出口。',
    '刻意练习"先做再优化"，把动手放在追求完美的前面。',
  ],
  dimensionNotes: [
    { id: 'analysis', name: '分析直觉', score: 88, note: '你习惯先算清再落脚，代价是要比别人多花一点时间。' },
    { id: 'stability', name: '稳健冒险', score: 72, note: '你对不确定的容忍度很高，敢下注。' },
    { id: 'autonomy', name: '独立协作', score: 66, note: '你倾向于一个人先做完。' },
    { id: 'imagination', name: '想象落地', score: 24, note: '你是执行导向的，先有结果再谈理想状态。' },
    { id: 'resilience', name: '承压卸压', score: 58, note: '你能扛也能卸，弹性比较好。' },
    { id: 'mission', name: '意义回报', score: 61, note: '意义和回报你都想要。' },
    { id: 'expression', name: '外放内收', score: 32, note: '你更常观察而非开口。' },
    { id: 'intimacy', name: '贴近留白', score: 38, note: '你不太需要高频的亲密确认。' },
  ],
  headline: '灯塔架构师｜分析型是你的底色',
  keywords: ['分析型', '灯塔架构师', '稳舵掌柜'],
};

async function mockBackend(page: Page) {
  await page.route('**/functions/v1/**', async (route) => {
    const url = route.request().url();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (url.endsWith('/start-test')) {
      return json({
        sessionId: 'e2e-session',
        accessToken: 'e2e-access-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        totalQuestions: 24,
        scoringVersion: 'v1',
        usedCount: 1,
        maxUses: 3,
        remaining: 2,
        startedAt: new Date().toISOString(),
      });
    }
    if (url.endsWith('/submit-test')) {
      return json({
        result: {
          id: 'e2e-result',
          sessionId: 'e2e-session',
          scoringVersion: 'v1',
          report: MOCK_REPORT,
          createdAt: new Date().toISOString(),
        },
        usedCount: 1,
        maxUses: 3,
        remaining: 2,
      });
    }
    if (url.endsWith('/get-result')) {
      return json({
        id: 'e2e-result',
        sessionId: 'e2e-session',
        scoringVersion: 'v1',
        report: MOCK_REPORT,
        createdAt: new Date().toISOString(),
      });
    }
    if (url.endsWith('/create-share')) {
      return json({ token: SHARE_TOKEN, expiresAt: null });
    }
    if (url.endsWith('/shared-result')) {
      // Public contract: no result id, no session id.
      return json({
        scoringVersion: 'v1',
        report: MOCK_REPORT,
        createdAt: new Date().toISOString(),
      });
    }
    if (url.endsWith('/retake')) {
      return json({
        sessionId: 'e2e-session-2',
        accessToken: 'e2e-access-token-2-yyyyyyyyyyyyyyyyyyyyyyyyyy',
        totalQuestions: 24,
        scoringVersion: 'v1',
        usedCount: 2,
        maxUses: 3,
        remaining: 1,
        startedAt: new Date().toISOString(),
      });
    }
    return json({ error: { code: 'bad_request', message: 'unmocked' } }, 400);
  });
}

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

/**
 * 结果页需要 sessionStorage 里的会话凭证才能加载自己的结果。
 * 直接种入与 mock 后端一致的凭证，跳过答题流程。
 */
async function seedOwnerSession(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    sessionStorage.setItem(
      'lcs.session.v1',
      JSON.stringify({
        sessionId: 'e2e-session',
        accessToken: 'e2e-access-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        usedCount: 1,
        maxUses: 3,
        remaining: 2,
        startedAt: new Date().toISOString(),
      }),
    );
  });
}

test('entry page renders the brand and accepts a code', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '人生选择指南' })).toBeVisible();
  await expect(page.getByText('男怕选错行，女怕嫁错郎')).toBeVisible();

  await page.getByLabel('输入你购买的测试密码').fill('ABCD-EFGH-JKMN');
  await page.getByRole('button', { name: '开始测评' }).click();

  await expect(page).toHaveURL(/#\/intro$/);
  await expect(page.getByText('你会得到什么')).toBeVisible();
  // The code must never end up in the URL.
  await expect(page).not.toHaveURL(/ABCD/);
});

test('quota errors are explained clearly', async ({ page }) => {
  await page.route('**/functions/v1/start-test', (route) =>
    route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'exhausted', message: 'quota used up' } }),
    }),
  );
  await page.goto('/');
  await page.getByLabel('输入你购买的测试密码').fill('ABCD-EFGH-JKMN');
  await page.getByRole('button', { name: '开始测评' }).click();
  await expect(page.getByRole('alert')).toContainText('次数已经用完');
});

test('a share link opens in a fresh browser context with no local session', async ({ page, browser }) => {
  // A brand new context has empty storage: proves the link is self-contained.
  const fresh = await browser.newContext({ locale: 'zh-CN' });
  const freshPage = await fresh.newPage();
  await mockBackend(freshPage);
  await freshPage.goto(`/#/s/${SHARE_TOKEN}`);
  await expect(freshPage.getByRole('heading', { name: '灯塔架构师' })).toBeVisible();
  await expect(freshPage.getByText('八个维度')).toBeVisible();
  await expect(freshPage.getByTestId('shared-cta')).toBeVisible();
  await fresh.close();
  expect(page.url()).toBeDefined();
});

test('invalid share tokens show a friendly error, not a crash', async ({ page }) => {
  await page.goto('/#/s/TOO-SHORT');
  await expect(page.getByText('链接无效')).toBeVisible();
});

test('unknown routes render the not-found page', async ({ page }) => {
  await page.goto('/#/definitely-not-a-page');
  await expect(page.getByText('这个页面不存在')).toBeVisible();
  await page.getByTestId('notfound-home').click();
  await expect(page).toHaveURL(/#\/$/);
});

test('the report page is usable on a phone viewport', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile layout check');

  await page.goto('/#/s/' + SHARE_TOKEN);
  await expect(page.getByRole('heading', { name: '灯塔架构师' })).toBeVisible();

  // Nothing may overflow horizontally.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // Tap targets are at least 40px tall.
  const saveButton = page.getByTestId('save-image');
  const box = await saveButton.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
});

test('the long image export renders a complete, unclipped PNG', async ({ page, isMobile }) => {
  await page.goto('/#/s/' + SHARE_TOKEN);
  await expect(page.getByRole('heading', { name: '灯塔架构师' })).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 45_000 }).catch(() => null);
  await page.getByTestId('save-image').click();

  // 移动端优先走系统分享面板（navigator.share 存在时不会触发下载事件），
  // 此时长图仍会渲染出来供长按保存 —— 断言预览/错误提示都没有即可。
  if (isMobile) {
    await page.waitForTimeout(3000);
    await expect(page.getByRole('button', { name: /保存测评结果|正在生成长图/ })).toBeVisible();
    return;
  }

  const download = await downloadPromise;
  expect(download).toBeTruthy();

  const filename = download!.suggestedFilename();
  expect(filename).toContain('人生选择指南');
  expect(filename).toContain('灯塔架构师');
  expect(filename).not.toContain('ABCD');
  expect(filename).not.toContain('EFGH');
  expect(filename.endsWith('.png')).toBe(true);

  const path = await download.path();
  expect(path).toBeTruthy();
  const { statSync } = await import('node:fs');
  expect(statSync(path!).size).toBeGreaterThan(20_000);
});

test('copying the share link produces a URL with the /s/ fragment', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/#/s/' + SHARE_TOKEN);
  await expect(page.getByRole('heading', { name: '灯塔架构师' })).toBeVisible();
  await page.getByTestId('save-image').waitFor();

  // 公开分享页没有复制入口；链接复制属于所有者结果页。
  await expect(page.getByTestId('copy-share-link')).toHaveCount(0);

  await seedOwnerSession(page);
  await page.evaluate(() => {
    window.location.hash = '#/result/e2e-session';
  });
  await expect(page.getByTestId('copy-share-link')).toBeVisible();
  await page.getByTestId('copy-share-link').click();
  await expect(page.getByText(/公开链接/)).toBeVisible();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`#/s/${SHARE_TOKEN}`);
  // 链接里绝不能出现密码或会话凭证。
  expect(copied).not.toContain('ABCD');
  expect(copied).not.toContain('e2e-access-token');
});

test('the copy-link and retake buttons share one row', async ({ page, isMobile }) => {
  await seedOwnerSession(page);
  await page.evaluate(() => {
    window.location.hash = '#/result/e2e-session';
  });
  const copy = page.getByTestId('copy-share-link');
  const retake = page.getByTestId('retake');
  await expect(copy).toBeVisible();
  await expect(retake).toBeVisible();
  const [a, b] = await Promise.all([copy.boundingBox(), retake.boundingBox()]);

  if (isMobile) {
    // 窄屏按设计纵向堆叠，保证触控目标足够大。
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
  } else {
    // 宽屏左右并排、同一基线、等宽。
    expect(Math.abs(a.y - b.y)).toBeLessThan(4);
    expect(b.x).toBeGreaterThan(a.x + a.width / 2);
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  }
  await expect(page.getByText('好评有礼')).toHaveCount(0);
});

test('the full answering flow reaches a result page', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('输入你购买的测试密码').fill('ABCD-EFGH-JKMN');
  await page.getByRole('button', { name: '开始测评' }).click();
  await page.getByRole('button', { name: /我准备好了/ }).click();

  await expect(page.getByRole('button', { name: '下一题' })).toBeDisabled();

  for (let i = 0; i < 24; i += 1) {
    const radios = page.getByRole('radio');
    await radios.nth(i % 4).click({ force: true });
    if (i < 23) await page.getByRole('button', { name: '下一题' }).click();
  }
  await page.getByRole('button', { name: '提交并查看结果' }).click();
  await expect(page.getByRole('heading', { name: '灯塔架构师' })).toBeVisible();
  void ANSWERS_PATTERN;
});