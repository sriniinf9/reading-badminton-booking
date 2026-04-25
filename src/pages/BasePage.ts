import { Page, Locator } from '@playwright/test';

export class BasePage {
  readonly page: Page;

  // ── Global nav ────────────────────────────────────────────────────────
  readonly loginLink:    Locator;
  readonly accountMenu:  Locator;
  readonly logoutButton: Locator;
  readonly cookieBanner: Locator;
  readonly cookieAccept:  Locator;

  constructor(page: Page) {
    this.page = page;

    this.loginLink    = page.getByRole('button', { name: /log in|sign in/i }).first();
    this.accountMenu  = page.getByRole('button', { name: /my account|account/i })
                            .or(page.locator('[data-testid="account-menu"]'));
    this.logoutButton = page.getByRole('button', { name: /log out|sign out/i })
                            .or(page.getByRole('link', { name: /log out|sign out/i }));

    this.cookieBanner = page.locator('#cookie-banner, [data-testid="cookie-banner"], .cookie-consent').first();
    this.cookieAccept  = page.getByRole('button', { name: /accept all|accept cookies|allow all/i })
                             .or(page.locator('#accept-all-cookies, [data-testid="accept-cookies"]'));
  }

  async dismissCookieBanner() {
    try {
      await this.cookieAccept.click({ timeout: 5000 });
    } catch {
      // banner not present — continue
    }
  }

  async navigate(path = '') {
    const base = process.env.BOOKING_URL || 'https://bookings.better.org.uk';
    await this.page.goto(`${base}${path}`);
    await this.dismissCookieBanner();
  }

  async isLoggedIn(): Promise<boolean> {
    return this.accountMenu.isVisible().catch(() => false);
  }
}
