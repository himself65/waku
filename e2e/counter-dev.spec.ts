// 01_counter dev mode, make sure development server is running correctly
import { expect } from '@playwright/test';
import { test } from './utils.js';

test('counter', async ({ page }) => {
  await page.goto('http://localhost:3002');
  await expect(page.locator('text=Count: 0')).toBeVisible();
  await page.click('text=Increment');
  await page.click('text=Increment');
  await page.click('text=Increment');
  await expect(page.locator('text=Count: 3')).toBeVisible();
});

test('SSR on dev mode should have server content', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto('http://localhost:3000');
  await expect(page.getByText('This is a server component.')).toBeVisible();
});
