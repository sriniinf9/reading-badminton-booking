import { test, expect } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { LoginPage }      from '../src/pages/LoginPage';
import { HomePage }       from '../src/pages/HomePage';
import { ActivitiesPage } from '../src/pages/ActivitiesPage';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EMAIL      = process.env.BETTER_EMAIL    ?? '';
const PASSWORD   = process.env.BETTER_PASSWORD ?? '';
const LOCATION_1 = process.env.LOCATION_1      ?? 'rivermead-leisure-complex';
const LOCATION_2 = process.env.LOCATION_2      ?? 'meadway-sports-centre';
const LOC1_NAME  = process.env.LOCATION_1_NAME ?? 'Rivermead Leisure Centre';
const LOC2_NAME  = process.env.LOCATION_2_NAME ?? 'Meadway Leisure Centre';

const BOOKING_OPEN_HOUR   = parseInt(process.env.BOOKING_OPEN_HOUR   ?? '22');
const BOOKING_OPEN_MINUTE = parseInt(process.env.BOOKING_OPEN_MINUTE ?? '0');
const SLOT_RETRY_ATTEMPTS = parseInt(process.env.SLOT_RETRY_ATTEMPTS ?? '3');
const SLOT_RETRY_DELAY_MS = parseInt(process.env.SLOT_RETRY_DELAY_MS ?? '30000');

// Always target exactly 7 days from today
function getTargetDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d;
}

function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

// If we are before the booking-open time, wait until it ticks over.
// Only waits up to 5 minutes to avoid hanging indefinitely.
async function waitUntilBookingOpens(page: { waitForTimeout: (ms: number) => Promise<void> }) {
  const now  = new Date();
  const open = new Date(now);
  open.setHours(BOOKING_OPEN_HOUR, BOOKING_OPEN_MINUTE, 2, 0); // +2 s buffer

  const waitMs = open.getTime() - now.getTime();
  if (waitMs > 0 && waitMs <= 5 * 60 * 1000) {
    console.log(
      `Pre-positioned. Waiting ${Math.ceil(waitMs / 1000)}s for slots to open ` +
      `at ${BOOKING_OPEN_HOUR}:${String(BOOKING_OPEN_MINUTE).padStart(2, '0')}…`
    );
    await page.waitForTimeout(waitMs);
    console.log('Booking window open — attempting now.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — Login
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Login – Better.org.uk Booking Portal', () => {

  test('should display login page correctly', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await expect(loginPage.emailField).toBeVisible();
    await expect(loginPage.passwordField).toBeVisible();
    await expect(loginPage.submitButton).toBeVisible();
    console.log('Login page loaded and all fields visible');
  });

  test('should reject invalid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    await loginPage.emailField.fill('invalid@test.com');
    await loginPage.passwordField.fill('wrongpassword');
    await loginPage.submitButton.click();

    const errorText = await loginPage.getErrorMessage();
    expect(errorText.length).toBeGreaterThan(0);
    console.log(`Error shown for bad credentials: "${errorText}"`);
  });

  test('should login successfully with valid credentials', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(EMAIL, PASSWORD);

    const homePage = new HomePage(page);
    expect(await homePage.isLoggedIn()).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — Home Page & Location Navigation
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Home Page – Location Selection', () => {

  test.beforeEach(async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(EMAIL, PASSWORD);
  });

  test('should navigate to Rivermead Leisure Centre', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goToLocation(LOCATION_1);

    const title = await homePage.getLocationTitle();
    expect(title.toLowerCase()).toContain('rivermead');
    console.log(`Rivermead page title: "${title}"`);
  });

  test('should navigate to Meadway Leisure Centre', async ({ page }) => {
    const homePage = new HomePage(page);
    await homePage.goToLocation(LOCATION_2);

    const title = await homePage.getLocationTitle();
    expect(title.toLowerCase()).toContain('meadway');
    console.log(`Meadway page title: "${title}"`);
  });

  test('should show badminton as an available activity at Rivermead', async ({ page }) => {
    const activitiesPage = new ActivitiesPage(page);
    await activitiesPage.goToActivities(LOCATION_1);

    await expect(activitiesPage.badmintonActivity).toBeVisible({ timeout: 15000 });
    console.log(`Badminton activity visible at ${LOC1_NAME}`);
  });

  test('should show badminton as an available activity at Meadway', async ({ page }) => {
    const activitiesPage = new ActivitiesPage(page);
    await activitiesPage.goToActivities(LOCATION_2);

    await expect(activitiesPage.badmintonActivity).toBeVisible({ timeout: 15000 });
    console.log(`Badminton activity visible at ${LOC2_NAME}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — Badminton Booking (7 days ahead)
//
// Weekend  → 17:00–18:00, try Rivermead then Meadway (any court)
// Weekday  → 18:40, try Rivermead Court 1 then Meadway (any court)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('Badminton Booking – Week Ahead', () => {

  test('book badminton 7 days ahead', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(EMAIL, PASSWORD);

    const targetDate = getTargetDate();
    const weekend    = isWeekend(targetDate);

    // Weekend: 5–6 pm; Weekday: 6:40 pm (60-min window for flexibility)
    const timeFrom  = weekend ? '17:00' : '18:40';
    const timeTo    = weekend ? '18:00' : '19:00';

    // Rivermead weekday → Court 1 preference; Meadway and weekends → any court
    const locations: Array<{ slug: string; name: string; courtPref?: string }> = [
      { slug: LOCATION_1, name: LOC1_NAME, courtPref: weekend ? undefined : 'Court 1' },
      { slug: LOCATION_2, name: LOC2_NAME, courtPref: undefined },
    ];

    const dayLabel = targetDate.toDateString();
    console.log(`\nTarget: ${dayLabel} (${weekend ? 'Weekend' : 'Weekday'})`);
    console.log(`Time window: ${timeFrom} – ${timeTo}`);

    const activitiesPage = new ActivitiesPage(page);

    for (const loc of locations) {
      console.log(`\nPre-positioning at ${loc.name}${loc.courtPref ? ` (prefer ${loc.courtPref})` : ''}…`);

      try {
        // Navigate to the timetable page BEFORE slots open so we are ready the instant they do
        await activitiesPage.goToActivities(loc.slug);
        await activitiesPage.selectBadminton();
        await activitiesPage.navigateToDate(targetDate);

        // Block here until the booking window opens (no-op if already past open time)
        await waitUntilBookingOpens(page);

        // Retry the slot grab — the page is refreshed between attempts to pick up
        // newly-opened slots in case the first grab fires fractionally too early
        let booked = false;
        for (let attempt = 1; attempt <= SLOT_RETRY_ATTEMPTS; attempt++) {
          try {
            if (attempt > 1) {
              console.log(`Retry ${attempt}/${SLOT_RETRY_ATTEMPTS} — refreshing timetable…`);
              await page.reload();
              await page.waitForLoadState('networkidle');
              await activitiesPage.navigateToDate(targetDate);
            }

            const bookedSlot = await activitiesPage.bookSlot(timeFrom, timeTo, loc.courtPref);
            console.log(`Slot selected at ${loc.name}: ${bookedSlot}`);

            await activitiesPage.addToBasketAndCheckout();
            const ref = await activitiesPage.confirmBooking();
            console.log(`Booking confirmed at ${loc.name}! Reference: ${ref}`);

            expect(ref).toBeTruthy();
            booked = true;
            break;

          } catch (slotErr) {
            console.warn(`Attempt ${attempt} failed at ${loc.name}: ${(slotErr as Error).message}`);
            if (attempt < SLOT_RETRY_ATTEMPTS) {
              console.log(`Waiting ${SLOT_RETRY_DELAY_MS / 1000}s before retry…`);
              await page.waitForTimeout(SLOT_RETRY_DELAY_MS);
            }
          }
        }

        if (booked) return; // done — stop trying other locations

      } catch (navErr) {
        console.warn(`Navigation failed for ${loc.name}: ${(navErr as Error).message}`);
      }
    }

    throw new Error(`No badminton slots available at any location for ${dayLabel} (${timeFrom}–${timeTo})`);
  });

});
