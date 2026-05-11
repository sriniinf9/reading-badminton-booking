import { test } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EMAIL    = process.env.BETTER_EMAIL    ?? '';
const PASSWORD = process.env.BETTER_PASSWORD ?? '';

test('debug: capture page flow screenshots', async ({ page }) => {
  test.setTimeout(3 * 60 * 1000);

  await page.context().addCookies([{
    name: 'OptanonAlertBoxClosed',
    value: new Date().toISOString(),
    domain: 'bookings.better.org.uk',
    path: '/',
    expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
  }]);

  // ── Step 1: Home page ─────────────────────────────────────────────────────
  await page.goto('https://bookings.better.org.uk/');
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: 'test-results/debug-01-home.png', fullPage: true });
  console.log('\n── Step 1: Home ──');
  console.log('URL:', page.url());
  console.log('Buttons:', await page.locator('button').allTextContents());

  // ── Step 2: Login ─────────────────────────────────────────────────────────
  const loginBtn = page.getByRole('button', { name: /log in|sign in/i }).first();
  await loginBtn.waitFor({ state: 'visible', timeout: 10000 });
  await loginBtn.click({ force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/debug-02-login-modal.png', fullPage: true });
  console.log('\n── Step 2: Login modal ──');
  console.log('URL:', page.url());
  console.log('Inputs:', await page.locator('input').evaluateAll((els: Element[]) =>
    (els as HTMLInputElement[]).map(e => `${e.type}[name=${e.name}][id=${e.id}]`)
  ));

  const emailInput = page.locator('input[type="email"], input[name="email"], input[id*="email"], input[id*="username"], input[id*="member"]').first();
  await emailInput.fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASSWORD);
  await page.screenshot({ path: 'test-results/debug-03-filled.png' });
  await page.locator('input[type="password"]').first().press('Enter');
  await page.waitForLoadState('load');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/debug-04-logged-in.png', fullPage: true });
  console.log('\n── Step 3: After login ──');
  console.log('URL:', page.url());
  console.log('Nav items:', await page.locator('header button, nav button, header a, nav a').allTextContents());

  // ── Step 4: Today's timetable (should always load) ────────────────────────
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const timetableUrl = `https://bookings.better.org.uk/location/rivermead-leisure-complex/badminton-40min/${dateStr}/by-time`;

  await page.goto(timetableUrl);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: 'test-results/debug-05-timetable-today.png', fullPage: true });
  console.log('\n── Step 4: Today timetable ──');
  console.log('URL:', page.url());
  console.log('Title:', await page.title());
  console.log('Page text (first 800 chars):', (await page.locator('body').innerText().catch(() => '')).slice(0, 800));

  const bookLinks = await page.getByRole('link', { name: /book/i }).or(page.getByRole('button', { name: /book/i })).allTextContents();
  console.log('"Book" links/buttons:', bookLinks);

  const timeLinks = await page.locator('a, button').filter({ hasText: /\d{1,2}:\d{2}/ }).allTextContents();
  console.log('Time-bearing elements:', timeLinks.slice(0, 20));

  await page.screenshot({ path: 'test-results/debug-06-timetable-scroll.png', fullPage: true });

  // ── Step 5: Check what a "Book" link's container looks like ───────────────
  const bookCount = await page.getByRole('link', { name: /book/i }).or(page.getByRole('button', { name: /book/i })).count();
  console.log(`\n── Step 5: Slot inspection (${bookCount} "Book" elements) ──`);
  for (let i = 0; i < Math.min(bookCount, 5); i++) {
    const link = page.getByRole('link', { name: /book/i }).or(page.getByRole('button', { name: /book/i })).nth(i);
    const containerText = await link.evaluate((el: Element) => {
      let node: Element | null = el;
      for (let d = 0; d < 8; d++) {
        node = node?.parentElement ?? null;
        if (!node) break;
        const t = node.textContent?.trim() ?? '';
        if (/\d{1,2}:\d{2}/.test(t) && t.length < 600) return t;
      }
      return '(no time found in ancestors)';
    });
    const href = await link.getAttribute('href').catch(() => '');
    console.log(`  [${i}] href="${href}" container="${containerText.slice(0, 120)}"`);
  }

  // ── Step 6: Saturday timetable (2 days ahead — should have slots) ─────────
  const sat = new Date(today);
  sat.setDate(sat.getDate() + 2);
  const satStr = `${sat.getFullYear()}-${String(sat.getMonth()+1).padStart(2,'0')}-${String(sat.getDate()).padStart(2,'0')}`;
  const satUrl = `https://bookings.better.org.uk/location/rivermead-leisure-complex/badminton-40min/${satStr}/by-time`;

  await page.goto(satUrl);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.screenshot({ path: 'test-results/debug-07-timetable-saturday.png', fullPage: true });
  console.log(`\n── Step 6: Saturday timetable (${satStr}) ──`);
  console.log('URL:', page.url());
  console.log('Page text (first 1000 chars):', (await page.locator('body').innerText().catch(() => '')).slice(0, 1000));

  const satBookLinks = page.getByRole('link', { name: /book/i }).or(page.getByRole('button', { name: /book/i }));
  const satBookCount = await satBookLinks.count();
  console.log(`"Book" links/buttons: ${satBookCount}`);

  for (let i = 0; i < Math.min(satBookCount, 8); i++) {
    const link = satBookLinks.nth(i);
    const href = await link.getAttribute('href').catch(() => '');
    const txt  = await link.textContent().catch(() => '');
    const containerText = await link.evaluate((el: Element) => {
      let node: Element | null = el;
      for (let d = 0; d < 10; d++) {
        node = node?.parentElement ?? null;
        if (!node) break;
        const t = node.textContent?.trim() ?? '';
        if (/\d{1,2}:\d{2}/.test(t) && t.length < 600) return t;
      }
      return '(no time in ancestors)';
    });
    console.log(`  [${i}] text="${txt?.trim()}" href="${href}" container="${containerText.slice(0, 150)}"`);
  }

  // ── Step 7: Dump raw HTML of slot cards to see actual element structure ────
  console.log('\n── Step 7: Raw slot HTML ──');
  const slotHtml = await page.evaluate(() => {
    // Find all elements containing a time pattern
    const all = Array.from(document.querySelectorAll('a, button, li, article, [class*="slot"], [class*="session"], [class*="card"], [class*="result"]'));
    const slots = all.filter(el => /\d{1,2}:\d{2}/.test(el.textContent ?? ''));
    return slots.slice(0, 5).map(el => ({
      tag: el.tagName,
      classes: el.className,
      href: (el as HTMLAnchorElement).href ?? '',
      outerHTML: el.outerHTML.slice(0, 500),
    }));
  });
  for (const s of slotHtml) {
    console.log(`TAG=${s.tag} class="${s.classes}" href="${s.href}"\n  HTML: ${s.outerHTML}\n`);
  }

  // ── Step 8: Verify new slot selector works ────────────────────────────────
  console.log('\n── Step 8: a[href*="/slot/"] selector test ──');
  const slotLinks = page.locator('a[href*="/slot/"]');
  const slotCount = await slotLinks.count();
  console.log(`Found ${slotCount} slot links`);
  for (let i = 0; i < slotCount; i++) {
    const href = await slotLinks.nth(i).getAttribute('href').catch(() => '');
    console.log(`  [${i}] href="${href}"`);
  }

  // ── Step 9: iframe and shadow DOM check ────────────────────────────────────
  console.log('\n── Step 8: iframes on page ──');
  const frames = page.frames();
  console.log(`Total frames: ${frames.length}`);
  for (const frame of frames) {
    console.log(`  frame url: ${frame.url()}`);
    const frameText = await frame.locator('body').innerText().catch(() => '');
    if (/\d{1,2}:\d{2}/.test(frameText)) {
      console.log('  *** TIME DATA FOUND IN THIS FRAME ***');
      console.log('  Frame text (first 500):', frameText.slice(0, 500));

      // Inspect links inside the frame
      const frameLinks = await frame.locator('a, button').filter({ hasText: /book/i }).all();
      for (const el of frameLinks.slice(0, 8)) {
        const txt  = await el.textContent().catch(() => '');
        const href = await el.getAttribute('href').catch(() => '');
        const tag  = await el.evaluate((n: Element) => n.tagName);
        console.log(`    ${tag} text="${txt?.trim()}" href="${href}"`);
      }

      // Dump raw HTML of time-bearing elements in the frame
      const frameSlotHtml = await frame.evaluate(() =>
        Array.from(document.querySelectorAll('a, button, li'))
          .filter(el => /\d{1,2}:\d{2}/.test(el.textContent ?? ''))
          .slice(0, 5)
          .map(el => el.outerHTML.slice(0, 400))
      );
      console.log('  Slot HTML inside frame:', frameSlotHtml);
    }
  }
});
