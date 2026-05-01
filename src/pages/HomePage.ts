import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class HomePage extends BasePage {

  // ── Home page locators ────────────────────────────────────────────────
  readonly locationCards:     Locator;
  readonly searchInput:       Locator;
  readonly searchButton:      Locator;
  readonly activityDropdown:  Locator;
  readonly bookActivityButton: Locator;

  constructor(page: Page) {
    super(page);

    this.locationCards     = page.locator(
      '[data-testid*="location"], .location-card, .venue-card, .centre-card'
    );
    this.searchInput       = page.getByPlaceholder(/postcode|search|location/i)
                                  .or(page.locator('input[name*="search"], input[id*="search"]').first());
    this.searchButton      = page.getByRole('button', { name: /search|find/i });
    this.activityDropdown  = page.getByLabel(/activity|i'm looking for/i)
                                  .or(page.locator('select[name*="activity"], [data-testid="activity-select"]').first());
    this.bookActivityButton = page.getByRole('link', { name: /book an activity|book activity/i })
                                   .or(page.getByRole('button', { name: /book an activity/i }));
  }

  async goto() {
    await this.navigate('/');
    await this.page.waitForLoadState('load');
  }

  async goToLocation(locationSlug: string) {
    await this.navigate(`/location/${locationSlug}`);
    await this.page.waitForLoadState('load');
    console.log(`Navigated to location: ${locationSlug}`);
  }

  async selectLocation(locationName: string): Promise<void> {
    const card = this.locationCards.filter({ hasText: new RegExp(locationName, 'i') }).first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await card.click();
    await this.page.waitForLoadState('load');
  }

  async getLocationTitle(): Promise<string> {
    const heading = this.page.getByRole('heading', { level: 1 });
    return (await heading.textContent()) ?? '';
  }
}
