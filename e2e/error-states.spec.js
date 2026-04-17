// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * E2E Error & Edge Case Tests.
 *
 * Verifies that the platform handles failures gracefully:
 * - Invalid login shows error message
 * - Short password rejected
 * - Duplicate registration rejected
 * - Forgot-password success feedback
 * - Empty audit list shows empty state
 * - Notification bell accessible
 * - Sign-out button accessible
 */

const TS = Date.now();

/** Navigate from landing to auth page */
async function goToAuth(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  const getStartedBtn = page.locator('button', { hasText: 'Get Started' }).first();
  await expect(getStartedBtn).toBeVisible({ timeout: 5000 });
  await getStartedBtn.click();
  
  await expect(page.locator('.auth-card')).toBeVisible({ timeout: 10000 });
}

/** Switch to sign-in form if currently on register form */
async function ensureSignInForm(page) {
  const signInToggle = page.locator('.auth-toggle button', { hasText: 'Sign in' });
  if (await signInToggle.isVisible().catch(() => false)) {
    await signInToggle.click();
  }
}

/** Switch to register form if currently on sign-in form */
async function ensureRegisterForm(page) {
  const registerToggle = page.locator('.auth-toggle button', { hasText: 'Register' });
  if (await registerToggle.isVisible().catch(() => false)) {
    await registerToggle.click();
  }
}

test.describe('Auth Error States', () => {

  test('shows error on invalid credentials', async ({ page }) => {
    await goToAuth(page);
    await ensureSignInForm(page);

    await page.locator('input[placeholder="Email address"]').fill('nonexistent@fake.dev');
    await page.locator('input[placeholder="Password"]').fill('WrongPassword99!');
    await page.locator('button.auth-button').click();

    // Error message should appear
    await expect(page.locator('.auth-error')).toBeVisible({ timeout: 10000 });
  });

  test('shows error for short password on register', async ({ page }) => {
    await goToAuth(page);
    await ensureRegisterForm(page);

    await page.locator('input[placeholder="Full name"]').fill('Short Pw');
    await page.locator('input[placeholder="Email address"]').fill(`shortpw-${TS}@test.dev`);
    await page.locator('input[placeholder="Password"]').fill('123');

    // Submit — browser validation should block (minLength=8) or API returns error
    await page.locator('button.auth-button').click();

    // Either browser validation prevents submission or error appears
    const errorVisible = await page.locator('.auth-error').isVisible({ timeout: 3000 }).catch(() => false);
    const validationMsg = await page.locator('input[placeholder="Password"]').evaluate(
      el => /** @type {HTMLInputElement} */ (el).validationMessage
    );

    expect(errorVisible || validationMsg.length > 0).toBe(true);
  });

  test('shows error for duplicate registration', async ({ page }) => {
    // First register a user via API using a fresh context to avoid session cookies
    const email = `dup-${TS}@test.dev`;
    const context = page.context();
    const apiPage = await context.newPage();
    await apiPage.request.post('http://localhost:4000/api/auth/register', {
      data: { email, password: 'DupTest1234!', name: 'Dup User' },
    });
    await apiPage.close();

    // Clear cookies so we land on the landing page
    await context.clearCookies();

    await goToAuth(page);
    await ensureRegisterForm(page);

    await page.locator('input[placeholder="Full name"]').fill('Dup User');
    await page.locator('input[placeholder="Email address"]').fill(email);
    await page.locator('input[placeholder="Password"]').fill('DupTest1234!');
    await page.locator('button.auth-button').click();

    // Should show error
    await expect(page.locator('.auth-error')).toBeVisible({ timeout: 10000 });
  });

  test('forgot-password shows success message', async ({ page }) => {
    await goToAuth(page);
    await ensureSignInForm(page);

    // Click "Forgot password?"
    const forgotLink = page.locator('.auth-forgot button');
    await forgotLink.click();

    // Fill email and submit
    await page.locator('input[placeholder="Email address"]').fill('anyone@test.dev');
    await page.locator('button.auth-button').click();

    // Success message (never reveals if email exists)
    await expect(page.locator('.auth-success')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.auth-success')).toContainText(/reset link/i);
  });
});

test.describe('Dashboard Error States', () => {

  test.beforeEach(async ({ page }) => {
    // Register and login
    const email = `e2e-err-${TS}@test.dev`;
    await page.request.post('http://localhost:4000/api/auth/register', {
      data: { email, password: 'ErrorTest123!', name: 'Error Tester' },
    }).catch(() => {});

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Check if already logged in from API register cookies
    const dashHeader = page.locator('.dashboard-header h1');
    const onboarding = page.locator('.onboarding-overlay');
    const alreadyLoggedIn = await dashHeader.isVisible({ timeout: 3000 }).catch(() => false)
      || await onboarding.isVisible({ timeout: 1000 }).catch(() => false);

    if (!alreadyLoggedIn) {
      await goToAuth(page);
      await ensureSignInForm(page);

      await page.locator('input[placeholder="Email address"]').fill(email);
      await page.locator('input[placeholder="Password"]').fill('ErrorTest123!');
      await page.locator('button.auth-button').click();

      await page.waitForSelector('.dashboard-header h1, .onboarding-overlay', { timeout: 15000 });
    }

    const skipBtn = page.locator('.onboarding-skip');
    if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await skipBtn.click();
    }
    await expect(
      page.getByRole('heading', { name: 'Audit History' })
    ).toBeVisible({ timeout: 10000 });
  });

  test('empty audit list shows empty state with upload CTA', async ({ page }) => {
    const emptyState = page.locator('.empty-state');
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    if (hasEmpty) {
      // Empty state should have instructional content
      await expect(emptyState).toContainText(/No audits/i);
      // Upload CTA should be present
      await expect(page.locator('.empty-state-btn')).toBeVisible();
    }
    // If audits exist, the table should be visible instead
    if (!hasEmpty) {
      await expect(page.locator('.scores-table')).toBeVisible();
    }
  });

  test('notification bell is visible', async ({ page }) => {
    // The notification bell button should be present in nav
    const notifBtn = page.locator('.dashboard-nav-right .dash-nav-btn').first();
    await expect(notifBtn).toBeVisible();

    // Click it — notification panel should appear
    await notifBtn.click();
    await expect(page.getByText('Notifications', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('sign-out button is accessible from dashboard', async ({ page }) => {
    const signOutBtn = page.locator('.dash-nav-btn.logout');
    await expect(signOutBtn).toBeVisible();
    await expect(signOutBtn).toContainText('Sign Out');
  });
});
