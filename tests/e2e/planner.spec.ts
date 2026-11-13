import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { CONVERSATION, CHIP_ANSWERS, ACK_NEEDLES } from '../../planner/eval/chen-gold.mjs';

const live = process.argv.includes('--live');

test('Chen conversation downloads a 6-page owner PDF from the rail', async ({ page }) => {
  await page.route('**/api/public/planner/**', async route => {
    const url = route.request().url();
    if (route.request().method() === 'POST' && url.endsWith('/sessions'))
      return route.fulfill({ json: { id: '11111111-1111-4111-8111-111111111111', revision: 0 } });
    if (route.request().method() === 'POST' && url.includes('/messages'))
      return route.fulfill({ json: { interpreter: { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null }, revision: 1 } });
    if (route.request().method() === 'PUT')
      return route.fulfill({ json: { revision: 2 } });
    return route.fulfill({ json: {} });
  });
  await page.goto(live ? 'https://www.upstateipvoice.com/planner/' : '/planner/');
  const box = page.locator('#architect-input');
  await expect(box).toBeVisible();
  for (let i = 0; i < CONVERSATION.length; i++) {
    await box.fill(CONVERSATION[i]);
    await page.locator('.composer-send').click();
    const assistant = page.locator('.chat-turn.assistant').last();
    await expect(assistant).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.chat-bubble.assistant.typing')).toHaveCount(0, { timeout: 20_000 });
    const ack = ACK_NEEDLES[i];
    if (ack) {
      const bubble = page.locator('.chat-bubble.assistant').last();
      for (const needle of ack.must)
        await expect(bubble).toContainText(new RegExp(needle, 'i'), { timeout: 20_000 });
      for (const forbidden of ack.mustNot)
        await expect(bubble).not.toContainText(forbidden);
    }
  }
  for (const label of Object.values(CHIP_ANSWERS).map(a => a.label)) {
    const chip = page.getByRole('button', { name: label });
    if (await chip.count())
      await chip.first().click();
  }
  const toggle = page.locator('.blueprint-sheet-toggle');
  if (await toggle.isVisible())
    await toggle.click();
  const rail = page.locator('.blueprint-rail');
  await expect(rail).toContainText(/Kingston/i);
  await expect(rail).toContainText(/12:30/);
  await expect(rail).toContainText(/2 desk|2 front-desk|both can pick up/i);
  await expect(rail).toContainText(/press 9/i);
  const identity = (await rail.locator('.blueprint-id').innerText()).replace(/\s+/g, ' ').trim();
  expect(identity).toMatch(/r\d+/);
  const [ownerDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /Download owner blueprint/i }).first().click()
  ]);
  const ownerBuf = await readFile(await ownerDownload.path() as string);
  const ownerPdf = await PDFDocument.load(ownerBuf);
  expect(ownerPdf.getPageCount()).toBe(6);
  const [engDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: /technical spec/i }).first().click()
  ]);
  const engBuf = await readFile(await engDownload.path() as string);
  const engPdf = await PDFDocument.load(engBuf);
  expect(engPdf.getPageCount()).toBeGreaterThanOrEqual(8);
  expect(identity).toMatch(/r\d+ · /);
});
