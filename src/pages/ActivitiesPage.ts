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
      '[data-testid*="slot"], .time-slot, .slot-item, .timetable-slot, td.slot'
    );
    this.availableSlots = this.timeSlots.filter({
      hasNot: page.locator('.unavailable, .full, .booked'),
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
    await this.page.waitForLoadState('networkidle');
  }

  async selectBadminton() {
    // If the page shows category cards, click "Sports Hall Activities" first
    const sportsVisible = await this.sportsHallCategory.isVisible().catch(() => false);
    if (sportsVisible) {
      await this.sportsHallCategory.click();
      await this.page.waitForLoadState('networkidle');
      console.log('Clicked Sports Hall Activities category');
    }

    await expect(this.badmintonActivity).toBeVisible({ timeout: 15000 });
    await this.badmintonActivity.click();
    await this.page.waitForLoadState('networkidle');
    console.log('Selected badminton activity');
  }

  async navigateToDate(targetDate: Date) {
    const targetStr = targetDate.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long',
    });
    console.log(`Navigating to date: ${targetStr}`);

    for (let attempt = 0; attempt < 30; attempt++) {
      const currentText = (await this.selectedDate.textContent()) ?? '';
      if (currentText.toLowerCase().includes(targetDate.getDate().toString())) break;
      await this.datePickerNext.click();
      await this.page.waitForTimeout(300);
    }
  }

  async getAvailableSlots(): Promise<TimeSlot[]> {
    const slots: TimeSlot[] = [];
    const count = await this.availableSlots.count();

    for (let i = 0; i < count; i++) {
      const slot      = this.availableSlots.nth(i);
      const timeText  = await slot.locator('.time, [data-time], time').first()
                                  .textContent().catch(() => '');
      const priceText = await slot.locator('.price, [data-price]').first()
                                  .textContent().catch(() => '');

      // Resolve court name from the closest <tr> row header or .court-name element
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

      slots.push({
        time:      (timeText ?? '').trim(),
        available: true,
        price:     (priceText ?? '').trim() || undefined,
        court:     courtText || undefined,
      });
    }
    return slots;
  }

  async bookSlot(timeFrom: string, timeTo: string, courtPref?: string): Promise<string> {
    const slots = await this.getAvailableSlots();
    console.log(`Found ${slots.length} available slots`);

    const [fromH, fromM] = timeFrom.split(':').map(Number);
    const [toH, toM]     = timeTo.split(':').map(Number);
    const fromMins = (fromH ?? 0) * 60 + (fromM ?? 0);
    const toMins   = (toH ?? 0)   * 60 + (toM ?? 0);

    const inWindow = (s: TimeSlot) => {
      const m = s.time.match(/(\d{1,2}):(\d{2})/);
      if (!m) return false;
      const mins = parseInt(m[1]!) * 60 + parseInt(m[2]!);
      return mins >= fromMins && mins <= toMins;
    };

    // Prefer court match; fall back to any slot in the window
    const chosen =
      (courtPref
        ? slots.find(s => inWindow(s) && s.court?.toLowerCase().includes(courtPref.toLowerCase()))
        : undefined)
      ?? slots.find(inWindow);

    if (!chosen) {
      throw new Error(
        `No slots available between ${timeFrom}–${timeTo}` +
        (courtPref ? ` (preferred: ${courtPref})` : '')
      );
    }

    const slotLabel = `${chosen.time}${chosen.court ? ` @ ${chosen.court}` : ''}`;
    console.log(`Booking: ${slotLabel}${chosen.price ? ` (${chosen.price})` : ''}`);

    // Click the slot — try court-scoped row first when a preference is given
    let slotLocator = this.availableSlots.filter({ hasText: chosen.time }).first();
    if (courtPref) {
      const courtRow   = this.page.locator('tr').filter({ hasText: new RegExp(courtPref, 'i') }).first();
      const courtSlot  = courtRow.locator(
        '[data-testid*="slot"], .time-slot, .slot-item, td.slot'
      ).filter({ hasText: chosen.time }).first();
      const scoped = await courtSlot.isVisible().catch(() => false);
      if (scoped) slotLocator = courtSlot;
    }

    await slotLocator.click();
    await this.page.waitForLoadState('networkidle');

    return slotLabel;
  }

  async addToBasketAndCheckout() {
    await expect(this.addToBasketButton).toBeVisible({ timeout: 10000 });
    await this.addToBasketButton.click();
    await this.page.waitForLoadState('networkidle');
    console.log('Added to basket');

    await expect(this.checkoutButton).toBeVisible({ timeout: 10000 });
    await this.checkoutButton.click();
    await this.page.waitForLoadState('networkidle');
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
