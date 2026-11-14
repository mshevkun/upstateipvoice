import { test, expect } from '@playwright/test';

/** One-receptionist smoke: finish chips, Lock at lab mode, checksum badge updates. */
test('one-receptionist Lock walk matches checksum', async ({ page }) => {
  let revision = 0;
  const checksum = 'a1b2c3d4';
  await page.route('**/api/public/planner/**', async route => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'POST' && url.endsWith('/sessions'))
      return route.fulfill({ json: { id: '22222222-2222-4222-8222-222222222222', revision: 0 } });
    if (method === 'POST' && url.includes('/messages'))
      return route.fulfill({ json: { interpreter: { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null }, revision: ++revision } });
    if (method === 'PUT')
      return route.fulfill({ json: { revision: ++revision } });
    if (method === 'POST' && url.includes('/lock')) {
      const body = route.request().postDataJSON() as { revision?: number; checksum?: string };
      expect(body.checksum).toBeTruthy();
      return route.fulfill({
        json: { lockedRevision: body.revision ?? revision, lockedChecksum: body.checksum || checksum }
      });
    }
    if (method === 'GET')
      return route.fulfill({ json: { id: '22222222-2222-4222-8222-222222222222', revision, plan: null } });
    return route.fulfill({ json: {} });
  });

  await page.goto('/planner/?lab=1');
  const box = page.locator('#architect-input');
  await expect(box).toBeVisible();
  await box.fill('Existing dental office in Albany. One receptionist. Front desk answers first. After hours voicemail. Weekdays nine to five. Call it Albany Smile Dental.');
  await page.locator('.composer-send').click();
  await expect(page.locator('.chat-bubble.assistant.typing')).toHaveCount(0, { timeout: 20_000 });

  for (let i = 0; i < 24; i++) {
    const chips = page.locator('.chat-chip:not(.quiet)');
    if (!(await chips.count()))
      break;
    const draft = page.locator('.chat-prompt-draft');
    if (await draft.isVisible().catch(() => false))
      break;
    await chips.first().click();
    await page.waitForTimeout(200);
  }

  const draft = page.locator('.chat-prompt-draft');
  await expect(draft).toBeVisible({ timeout: 20_000 });
  const book = draft.getByRole('button', { name: /Book a walkthrough/i });
  await expect(book).toBeVisible();
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    book.click()
  ]);
  await expect(popup).toHaveURL(/[?&]plan=/);
  await expect(popup).toHaveURL(/[?&]s=/);
  await popup.close();

  const toggle = page.locator('.blueprint-sheet-toggle');
  if (await toggle.isVisible())
    await toggle.click();
  const lock = page.getByRole('button', { name: /Lock this revision/i });
  await expect(lock).toBeVisible({ timeout: 15_000 });
  await lock.click();
  await expect(page.locator('.blueprint-id')).toContainText(/LOCKED/i, { timeout: 10_000 });
});
