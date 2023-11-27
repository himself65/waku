// 01_counter
import { expect } from '@playwright/test';
import { test } from './utils.js';

test('counter', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page.locator('text=Count: 0')).toBeVisible();
  await page.click('text=Increment');
  await page.click('text=Increment');
  await page.click('text=Increment');
  await expect(page.locator('text=Count: 3')).toBeVisible();
});
