import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export interface TimeSlot {
  time:      string;
  available: boolean;
  price?:    string;
  court?:    string;
}

export class ActivitiesPage extends BasePage {

  // ── Activity list locators ────────────────────────────────────────────
  readonly activityList:       Locator;
  readonly badmintonActivity:  Locator;
  readonly sportsHallCategory: Locator;
  readonly datePickerNext:     Locator;
  readonly datePickerPrev:     Locator;
  readonly selectedDate:       Locator;

  // ── Time slot locators ────────────────────────────────────────────────
  readonly timeSlots:          Locator;
  readonly availableSlots:     Locator;

  // ── Booking confirmation locators ─────────────────────────────────────
  readonly addToBasketButton:  Locator;
  readonly basketSummary:      Locator;
  readonly checkoutButton:     Locator;
  readonly confirmButton:      Locator;
  readonly bookingConfirmation: Locator;
  readonly bookingReference:   Locator;

  constructor(page: Page) {
    super(page);

    this.activityList = page.locator(
      '[data-testid*="activity"], .activity-list, .activity-item, .timetable-item'
    );

    // Category card shown before individual activities (e.g. "Sports Hall Activities")
    this.sportsHallCategory = page.locator(
      'button, a, [role="button"], .activity-card, li'
    ).filter({ hasText: /sports hall/i }).first();

    this.badmintonActivity = page.locator(
      '[data-testid*="badminton"], .activity-card, li, .timetable-row, a, button'
    ).filter({ hasText: /badminton/i }).first();

    this.datePickerNext = page.getByRole('button', { name: /next day|next|forward|>/i }).first();
    this.datePickerPrev = page.getByRole('button', { name: /previous day|prev|back|</i }).first();
    this.selectedDate   = page.locator('[data-testid="selected-date"], .selected-date, .current-date').first();

    this.timeSlots      = page.locator(
      '[data-testid*="slot"], .time-slot, .slot-item, .timetable-slot, td.slot, ' +
      '.session, .activity-session, .timetable-session, [class*="session"], [class*="slot"]'
    );
    this.availableSlots = this.timeSlots.filter({
      hasNot: page.locator('.unavailable, .full, .booked, .sold-out, [class*="unavailable"], [class*="booked"], [class*="sold-out"]'),
    });

    this.addToBasketButton  = page.getByRole('button', { name: /add to basket|add to cart|book/i }).first();
    this.basketSummary      = page.locator('[data-testid="basket"], .basket, .cart-summary').first();
    this.checkoutButton     = page.getByRole('button', { name: /checkout|proceed to checkout/i })
                                   .or(page.getByRole('link', { name: /checkout/i })).first();
    this.confirmButton      = page.getByRole('button', { name: /confirm booking|confirm|pay now|complete/i }).first();
    this.bookingConfirmation = page.getByText(/booking confirmed|booking successful|thank you/i).first();
    this.bookingReference   = page.locator(
      '[data-testid="booking-ref"], .booking-reference, .confirmation-number'
    ).first();
  }

  async goToActivities(locationSlug: string) {
    await this.navigate(`/location/${locationSlug}`);
    await this.page.waitForLoadState('load');
  }

  async navigateDirectlyToTimetable(locationSlug: string, targetDate: Date) {
    const yyyy    = targetDate.getFullYear();
    const mm      = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd      = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    // Try known URL patterns for Better.org.uk badminton timetables
    const candidates = [
      `/location/${locationSlug}/badminton-40min/${dateStr}/by-time`,
      `/location/${locationSlug}/badminton-60min/${dateStr}/by-time`,
      `/location/${locationSlug}/badminton-sessions/${dateStr}/by-time`,
      `/location/${locationSlug}/sports-hall-activities/badminton-40min/${dateStr}/by-time`,
    ];

    for (const url of candidates) {
      console.log(`Trying timetable URL: ${url}`);
      await this.navigate(url);
      await this.page.waitForLoadState('load');
      // SPA: wait for JS to hydrate before inspecting the URL or content
      await this.page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
      await this.page.waitForSelector('a, button', { timeout: 15000 }).catch(() => {});
      if (!this.page.url().includes(dateStr)) {
        console.log(`Redirected away from ${dateStr} — got: ${this.page.url()}`);
        continue;
      }
      // Reject SPA 404 pages (URL matches but content is an error page)
      const bodyText = await this.page.locator('body').innerText().catch(() => '');
      if (/gone offside|doesn't exist|not found|404/i.test(bodyText)) {
        console.log(`404 error page at ${url} — skipping`);
        continue;
      }
      console.log(`Timetable loaded: ${this.page.url()}`);
      return;
    }
    throw new Error(`Timetable navigation failed for all URL patterns — last URL: ${this.page.url()}`);
  }

  async selectBadminton() {
    // If the page shows category cards, click "Sports Hall Activities" first
    const sportsVisible = await this.sportsHallCategory.isVisible().catch(() => false);
    if (sportsVisible) {
      await this.sportsHallCategory.click();
      await this.page.waitForLoadState('load');
      console.log('Clicked Sports Hall Activities category');
    }

    await expect(this.badmintonActivity).toBeVisible({ timeout: 15000 });
    await this.badmintonActivity.click();
    await this.page.waitForLoadState('load');
    console.log('Selected badminton activity');
  }

  async navigateToDate(targetDate: Date) {
    const yyyy    = targetDate.getFullYear();
    const mm      = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd      = String(targetDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    // The site uses URL-based date navigation:
    // /location/{slug}/badminton-60min/{YYYY-MM-DD}/by-time
    const base        = process.env.BOOKING_URL || 'https://bookings.better.org.uk';
    const currentUrl  = this.page.url();
    let   path        = currentUrl.startsWith(base) ? currentUrl.slice(base.length) : currentUrl;
    path = path.replace(/\/\d{4}-\d{2}-\d{2}.*$/, '');

    const targetUrl = `${path}/${dateStr}/by-time`;
    console.log(`Navigating to date: ${dateStr} (${targetUrl})`);
    await this.navigate(targetUrl);
    await this.page.waitForLoadState('load');
    if (!this.page.url().includes(dateStr)) {
      throw new Error(`Date navigation failed — expected URL to contain ${dateStr}, got: ${this.page.url()}`);
    }
  }

  async getAvailableSlots(): Promise<TimeSlot[]> {
    const slots: TimeSlot[] = [];
    let count = await this.availableSlots.count();

    // Fallback: if specific class selectors find nothing, scan for any link/button
    // whose visible text contains a time pattern (HH:MM) and isn't marked unavailable.
    if (count === 0) {
      console.log('Specific slot selectors returned 0 — trying broad time-link fallback');
      const timeLinks = this.page.locator('a, button').filter({
        hasText: /\b\d{1,2}:\d{2}\b/,
        hasNot:  this.page.locator('.unavailable, .full, .booked, .sold-out, [class*="unavailable"], [class*="booked"]'),
      });
      count = await timeLinks.count();
      console.log(`Fallback found ${count} time-bearing links`);
      for (let i = 0; i < count; i++) {
        const el      = timeLinks.nth(i);
        const text    = ((await el.textContent().catch(() => '')) ?? '').trim();
        const timeMatch = text.match(/\b(\d{1,2}:\d{2})\b/);
        if (!timeMatch) continue;
        const court = await el.evaluate((node: Element) => {
          const row = node.closest('tr');
          if (row) {
            const th = row.querySelector('th, .court-name, [data-court]') as HTMLElement | null;
            if (th) return th.textContent?.trim() ?? '';
          }
          return '';
        }).catch(() => '');
        slots.push({ time: timeMatch[1]!, available: true, court: court || undefined });
      }
      return slots;
    }

    for (let i = 0; i < count; i++) {
      const slot      = this.availableSlots.nth(i);
      const timeText  = await slot.locator('.time, [data-time], time').first()
                                  .textContent().catch(() => '');
      const fullText  = ((await slot.textContent().catch(() => '')) ?? '').trim();
      const timeMatch = fullText.match(/\b(\d{1,2}:\d{2})\b/);
      const priceText = await slot.locator('.price, [data-price]').first()
                                  .textContent().catch(() => '');

      const courtText = await slot.evaluate((el: Element) => {
        const row = el.closest('tr');
        if (row) {
          const header = row.querySelector('th, .court-name, [data-court]') as HTMLElement | null;
          if (header) return header.textContent?.trim() ?? '';
          const first = row.querySelector('td') as HTMLElement | null;
          if (first && first !== el) return first.textContent?.trim() ?? '';
        }
        const parent = el.closest('[class*="court"], [data-court]') as HTMLElement | null;
        return parent?.dataset?.court ?? parent?.textContent?.trim() ?? '';
      }).catch(() => '');

      const time = ((timeText ?? '').trim()) || (timeMatch ? timeMatch[1]! : '');
      if (!time) continue;
      slots.push({
        time,
        available: true,
        price:     (priceText ?? '').trim() || undefined,
        court:     courtText || undefined,
      });
    }
    return slots;
  }

  async bookSlot(timeFrom: string, timeTo: string, courtPref?: string): Promise<string> {
    await this.page.waitForLoadState('load');
    // SPA: ensure React has rendered before scanning for slots
    await this.page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    const [fromH, fromM] = timeFrom.split(':').map(Number);
    const [toH, toM]     = timeTo.split(':').map(Number);
    const fromMins = (fromH ?? 0) * 60 + (fromM ?? 0);
    const toMins   = (toH ?? 0)   * 60 + (toM ?? 0);

    // Available slots are <a href="…/slot/HH:MM-HH:MM/id"> in the Shadow DOM.
    // Fully-booked slots are <button> with no href. Nav links go to /redirect-to-selected-venue.
    // Using href*="/slot/" pinpoints only bookable slots without touching nav or booked buttons.
    const slotLinks = this.page.locator('a[href*="/slot/"]');
    const slotCount = await slotLinks.count();
    console.log(`Found ${slotCount} available slot links`);

    for (let i = 0; i < slotCount; i++) {
      const link = slotLinks.nth(i);
      const href  = (await link.getAttribute('href').catch(() => '')) ?? '';

      // Time is embedded in the href: …/slot/08:00-08:40/id
      const timeMatch = href.match(/\/slot\/(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\//);
      if (!timeMatch) continue;
      const [startH, startM] = timeMatch[1]!.split(':').map(Number);
      const slotMins = (startH ?? 0) * 60 + (startM ?? 0);
      if (slotMins < fromMins || slotMins > toMins) continue;

      // Court preference: check the slot card's visible text
      if (courtPref) {
        const cardText = (await link.textContent().catch(() => '')) ?? '';
        if (!cardText.toLowerCase().includes(courtPref.toLowerCase())) continue;
      }

      const label = `${timeMatch[1]}${courtPref ? ` @ ${courtPref}` : ''}`;
      console.log(`Booking slot: ${label} (${href})`);
      await link.click();
      await this.page.waitForLoadState('load');
      return label;
    }

    // No court-pref match — retry without preference
    if (courtPref) {
      console.log(`No "${courtPref}" slot found, retrying without court preference…`);
      return this.bookSlot(timeFrom, timeTo, undefined);
    }

    // Diagnostics
    const pageTitle = await this.page.title();
    const pageText  = await this.page.locator('body').innerText().catch(() => '').then(t => t.slice(0, 500));
    console.error(`[bookSlot] FAILED — URL: ${this.page.url()}`);
    console.error(`[bookSlot] Page title: "${pageTitle}"`);
    console.error(`[bookSlot] Available slot links found: ${slotCount}`);
    console.error(`[bookSlot] Page text: ${pageText}`);

    throw new Error(`No slots available between ${timeFrom}–${timeTo}`);
  }

  async addToBasketAndCheckout() {
    await expect(this.addToBasketButton).toBeVisible({ timeout: 10000 });
    await this.addToBasketButton.click();
    await this.page.waitForLoadState('load');
    console.log('Added to basket');

    await expect(this.checkoutButton).toBeVisible({ timeout: 10000 });
    await this.checkoutButton.click();
    await this.page.waitForLoadState('load');
    console.log('Proceeding to checkout');
  }

  async confirmBooking(): Promise<string> {
    await expect(this.confirmButton).toBeVisible({ timeout: 10000 });
    await this.confirmButton.click();

    await expect(this.bookingConfirmation).toBeVisible({ timeout: 20000 });

    const ref = await this.bookingReference.textContent().catch(() => 'N/A');
    console.log(`Booking confirmed! Reference: ${ref}`);
    return (ref ?? 'N/A').trim();
  }
}
