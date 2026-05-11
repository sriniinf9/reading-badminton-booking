import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  testDir: './tests',
  timeout: 2700000, // 45 min — booking test waits up to 5 min for window to open + retries + networkidle
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['monocart-reporter', {
      name: 'Badminton Booking Test Report',
      outputFile: 'monocart-report/index.html',
    }],
  ],

  use: {
    baseURL: process.env.BOOKING_URL || 'https://bookings.better.org.uk',
    headless: process.env.HEADLESS !== 'false',
    viewport: { width: 1280, height: 800 },
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
