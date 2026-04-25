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

    this.emailField    = page.getByLabel(/email address|email/i)
                             .or(page.locator('input[type="email"], input[name="email"], input[id*="email"]').first());

    this.passwordField = page.locator('input[type="password"]').first();

    this.submitButton  = page.getByRole('button', { name: /log in|sign in|login/i })
                             .or(page.locator('button[type="submit"]').first());

    this.errorMessage  = page.locator(
      '[data-testid="login-error"], .error-message, .alert-danger, [role="alert"]'
    ).first();

    this.forgotPassword = page.getByRole('link', { name: /forgot.*(password)?|reset password/i });
  }

  async goto() {
    await this.navigate('/');
    await this.loginLink.click();
    await expect(this.submitButton).toBeVisible({ timeout: 15000 });
  }

  async login(email: string, password: string) {
    await this.emailField.fill(email);
    await this.passwordField.fill(password);
    await this.submitButton.click();
    await this.accountMenu.waitFor({ state: 'visible', timeout: 20000 });
    console.log('Logged in successfully');
  }

  async getErrorMessage(): Promise<string> {
    await this.errorMessage.waitFor({ state: 'visible', timeout: 5000 });
    return (await this.errorMessage.textContent()) ?? '';
  }
}
