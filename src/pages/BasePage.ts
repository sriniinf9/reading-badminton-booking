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

    this.cookieBanner = page.locator('#cookie-banner, [data-testid="cookie-banner"], .cookie-consent, #onetrust-banner-sdk').first();
    this.cookieAccept  = page.locator('#onetrust-accept-btn-handler')
                             .or(page.getByRole('button', { name: /accept all|accept cookies|allow all/i }))
                             .or(page.locator('#accept-all-cookies, [data-testid="accept-cookies"]'));
  }

  async dismissCookieBanner() {
    try {
      // Use JS eval to click through any overlay / iframe boundary
      await this.page.evaluate(() => {
        const btn =
          document.getElementById('onetrust-accept-btn-handler') ??
          document.querySelector<HTMLElement>('.onetrust-accept-btn-handler') ??
          Array.from(document.querySelectorAll<HTMLElement>('button')).find(
            b => /accept all/i.test(b.textContent ?? '')
          );
        btn?.click();
      });
      // Wait for the OneTrust SDK container to disappear
      await this.page.locator('#onetrust-consent-sdk').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    } catch {
      // no banner — continue
    }
  }

  async navigate(path = '') {
    const base = process.env.BOOKING_URL || 'https://bookings.better.org.uk';
    // Pre-set OneTrust consent cookie so the banner never renders
    await this.page.context().addCookies([{
      name: 'OptanonAlertBoxClosed',
      value: new Date().toISOString(),
      domain: new URL(base).hostname,
      path: '/',
      expires: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
    }]);
    await this.page.goto(`${base}${path}`);
  }

  async isLoggedIn(): Promise<boolean> {
    return this.accountMenu.isVisible().catch(() => false);
  }
}
