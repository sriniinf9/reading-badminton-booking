import { test } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EMAIL    = process.env.BETTER_EMAIL    ?? '';
const PASSWORD = process.env.BETTER_PASSWORD ?? '';

test('debug: capture page flow screenshots', async ({ page }) => {
  // Step 1: Home page
  await page.goto('https://bookings.better.org.uk/');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/debug-01-home.png', fullPage: true });
  console.log('Step 1 URL:', page.url());
  console.log('Step 1 buttons:', await page.locator('button').allTextContents());

  // Step 2: Click login button
  const loginBtn = page.getByRole('button', { name: /log in|sign in/i }).first();
  await loginBtn.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/debug-02-after-login-click.png', fullPage: true });
  console.log('Step 2 URL:', page.url());

  // Step 3: Fill and submit
  const emailInput = page.locator('input[type="email"], input[name="email"], input[id*="email"], input[id*="username"], input[id*="member"]').first();
  await emailInput.fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.screenshot({ path: 'test-results/debug-03-filled.png' });

  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/debug-04-after-submit.png', fullPage: true });
  console.log('Step 4 URL:', page.url());
  console.log('Step 4 header buttons:', await page.locator('header button, nav button, header a, nav a').allTextContents());

  // Step 5: Navigate to activities
  await page.goto('https://bookings.better.org.uk/location/rivermead-leisure-complex');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/debug-05-activities.png', fullPage: true });
  console.log('Step 5 URL:', page.url());
  console.log('Step 5 header:', await page.locator('header button, nav button, header a, nav a').allTextContents());
  console.log('Step 5 activity links:', await page.locator('a, button').filter({ hasText: /sport|badminton|activities/i }).allTextContents());

  // Step 6: Click Sports Hall Activities if visible
  const sportsHall = page.locator('a, button').filter({ hasText: /sports hall/i }).first();
  const sportsHallCount = await sportsHall.count();
  if (sportsHallCount > 0) {
    await sportsHall.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/debug-06-sports-hall.png', fullPage: true });
    console.log('Step 6 URL:', page.url());
    console.log('Step 6 links:', await page.locator('a, button').allTextContents().then(a => a.slice(0, 30)));
  }
});
