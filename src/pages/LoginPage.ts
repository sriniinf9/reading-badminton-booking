import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {

  // ── Login form locators ───────────────────────────────────────────────
  readonly emailField:    Locator;
  readonly passwordField: Locator;
  readonly submitButton:  Locator;
  readonly errorMessage:  Locator;
  readonly forgotPassword: Locator;

  constructor(page: Page) {
    super(page);

    this.emailField    = page.locator(
                             'input[type="email"], input[name="email"], input[id*="email"], input[id*="username"], input[id*="member"]'
                           ).first();

    this.passwordField = page.locator('input[type="password"]').first();

    this.submitButton  = page.locator('button[type="submit"]').first();

    this.errorMessage  = page.locator(
      '[data-testid="login-error"], .error-message, .alert-danger, [role="alert"]'
    ).first();

    this.forgotPassword = page.getByRole('link', { name: /forgot.*(password)?|reset password/i });
  }

  async goto() {
    await this.navigate('/');
    await this.dismissCookieBanner();
    // Wait only for the login button itself — avoids slow networkidle on the SPA homepage
    await this.loginLink.waitFor({ state: 'visible', timeout: 15000 });
    await this.loginLink.click({ force: true });
    await expect(this.submitButton).toBeVisible({ timeout: 15000 });
  }

  async login(email: string, password: string) {
    await this.emailField.fill(email);
    await this.passwordField.fill(password);
    // Press Enter to submit — avoids button-targeting issues
    await this.passwordField.press('Enter');
    await this.page.waitForLoadState('load');

    // Check for a login error before waiting for success
    const errorVisible = await this.errorMessage.isVisible().catch(() => false);
    if (errorVisible) {
      const msg = (await this.errorMessage.textContent().catch(() => '')) ?? '';
      throw new Error(`Login failed: ${msg.trim()}`);
    }

    // Login succeeded when the form/modal closes (email field disappears)
    await expect(this.emailField).toBeHidden({ timeout: 20000 });
    console.log('Logged in successfully');
  }

  async getErrorMessage(): Promise<string> {
    await this.errorMessage.waitFor({ state: 'visible', timeout: 5000 });
    return (await this.errorMessage.textContent()) ?? '';
  }
}
