// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

/**
 * E2E Critical Path — "Open for Business" smoke audit.
 *
 * Journey: Register → Login → Upload DPA → View audit table → Filter by status →
 *          View report → Navigate to Settings → Return to dashboard → Sign Out.
 *
 * Runs against live React dashboard (port 3000) + Express API (port 4000) + PostgreSQL.
 */

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'sample-dpa.txt');
const TS = Date.now();
const TEST_EMAIL = `e2e-pw-${TS}@test.dev`;
const TEST_PASSWORD = 'PlaywrightE2E123!';
const TEST_NAME = 'Playwright User';

/** Navigate from landing to auth page */
async function goToAuth(page) {
  await page.goto('/');
  // Wait for the landing page to fully render
  await page.waitForLoadState('networkidle');
  
  // Click "Get Started" in the nav bar (not the hero CTA which says "Start Free Audit")
  const getStartedBtn = page.locator('button', { hasText: 'Get Started' }).first();
  await expect(getStartedBtn).toBeVisible({ timeout: 5000 });
  await getStartedBtn.click();
  
  // Wait for auth card to appear (React SPA state change)
  await expect(page.locator('.auth-card')).toBeVisible({ timeout: 10000 });
}

/** Login via UI and land on dashboard */
async function loginViaUI(page, email, password) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // After registration via API, cookies may already authenticate the user.
  // Check if we're already on the dashboard.
  const dashHeader = page.locator('.dashboard-header h1');
  const onboarding = page.locator('.onboarding-overlay');
  const alreadyLoggedIn = await dashHeader.isVisible({ timeout: 3000 }).catch(() => false)
    || await onboarding.isVisible({ timeout: 1000 }).catch(() => false);

  if (!alreadyLoggedIn) {
    // Need to go through auth flow
    await goToAuth(page);

    // Make sure we're on sign-in form
    const signInToggle = page.locator('.auth-toggle button', { hasText: 'Sign in' });
    if (await signInToggle.isVisible().catch(() => false)) {
      await signInToggle.click();
    }

    await page.locator('input[placeholder="Email address"]').fill(email);
    await page.locator('input[placeholder="Password"]').fill(password);
    await page.locator('button.auth-button').click();

    // Wait for dashboard or onboarding
    await page.waitForSelector('.dashboard-header h1, .onboarding-overlay', { timeout: 15000 });
  }

  // Dismiss onboarding if present
  const skipBtn = page.locator('.onboarding-skip');
  if (await skipBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await skipBtn.click();
  }

  // Wait until we see audit history heading
  await expect(
    page.getByRole('heading', { name: 'Audit History' })
  ).toBeVisible({ timeout: 10000 });
}

// ─── Auth Flow ────────────────────────────────────────

test.describe('Auth Flow', () => {

  test('shows the landing page with sign-in option', async ({ page }) => {
    await page.goto('/');
    // Landing h1 contains the tagline
    await expect(page.locator('h1')).toContainText('Audit your DPAs');
    // Sign In and Get Started buttons should be visible
    await expect(page.locator('button.landing-btn-ghost')).toContainText('Sign In');
    await expect(page.locator('button.landing-btn-primary').first()).toBeVisible();
  });

  test('registers a new account', async ({ page }) => {
    await goToAuth(page);

    // Switch to register mode — click "Register" in the toggle
    const registerToggle = page.locator('.auth-toggle button', { hasText: 'Register' });
    if (await registerToggle.isVisible().catch(() => false)) {
      await registerToggle.click();
    }

    // Fill registration form
    await page.locator('input[placeholder="Full name"]').fill(TEST_NAME);
    await page.locator('input[placeholder="Email address"]').fill(TEST_EMAIL);
    await page.locator('input[placeholder="Password"]').fill(TEST_PASSWORD);

    // Submit
    await page.locator('button.auth-button').click();

    // Should land on onboarding or dashboard
    await page.waitForSelector('.onboarding-overlay, .dashboard-header', { timeout: 15000 });

    // If onboarding, verify welcome and dismiss
    const onboarding = page.locator('.onboarding-overlay');
    if (await onboarding.isVisible().catch(() => false)) {
      await expect(page.locator('.onboarding-card h2')).toContainText('Welcome');
      await page.locator('.onboarding-skip').click();
    }

    // Should see dashboard
    await expect(page.locator('.dashboard-header h1')).toContainText('Auleg');
    await expect(page.locator('.subtitle')).toContainText(/Welcome/);
  });
});

// ─── Authenticated Journey ────────────────────────────

test.describe('Authenticated Journey', () => {

  test.beforeEach(async ({ page }) => {
    // Register via API (may already exist)
    await page.request.post('http://localhost:4000/api/auth/register', {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD, name: TEST_NAME },
    }).catch(() => {});

    await loginViaUI(page, TEST_EMAIL, TEST_PASSWORD);
  });

  test('displays the dashboard with welcome message', async ({ page }) => {
    await expect(page.locator('.dashboard-header h1')).toContainText('Auleg');
    await expect(page.locator('.subtitle')).toContainText(/Welcome/);
  });

  test('shows the audit table or empty state', async ({ page }) => {
    const table = page.locator('.scores-table');
    const emptyState = page.locator('.empty-state');
    const hasTable = await table.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);
    expect(hasTable || hasEmpty).toBe(true);
  });

  test('uploads a DPA contract and sees it in the audit list', async ({ page }) => {
    // The file input is hidden — set files directly
    const fileInput = page.locator('input[type="file"][accept=".txt,.pdf,.docx"]').first();
    await fileInput.setInputFiles(FIXTURE_PATH);

    // Wait for the contract name to appear in the table
    await expect(page.getByText('sample-dpa.txt')).toBeVisible({ timeout: 30000 });
  });

  test('audit shows status badge (complete or processing)', async ({ page }) => {
    // Upload if no audit visible
    const contractVisible = await page.getByText('sample-dpa.txt').isVisible().catch(() => false);
    if (!contractVisible) {
      const fileInput = page.locator('input[type="file"][accept=".txt,.pdf,.docx"]').first();
      await fileInput.setInputFiles(FIXTURE_PATH);
      await expect(page.getByText('sample-dpa.txt')).toBeVisible({ timeout: 30000 });
    }

    // Status badge shows the status text
    const statusBadge = page.locator('.risk-badge').first();
    await expect(statusBadge).toBeVisible();
    const statusText = await statusBadge.textContent();
    expect(['complete', 'processing', 'pending']).toContain(statusText?.toLowerCase());
  });

  test('filters audits by status', async ({ page }) => {
    // Ensure at least one audit exists
    const contractVisible = await page.getByText('sample-dpa.txt').isVisible().catch(() => false);
    if (!contractVisible) {
      const fileInput = page.locator('input[type="file"][accept=".txt,.pdf,.docx"]').first();
      await fileInput.setInputFiles(FIXTURE_PATH);
      await expect(page.getByText('sample-dpa.txt')).toBeVisible({ timeout: 30000 });
    }

    // Use the status filter dropdown (first select.role-select)
    const statusSelect = page.locator('select.role-select').first();
    await statusSelect.selectOption('complete');

    await page.waitForTimeout(1000);

    // All visible badges should say "complete"
    const badges = page.locator('.scores-table .risk-badge');
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      const text = await badges.nth(i).textContent();
      expect(text?.toLowerCase()).toBe('complete');
    }

    // Clear filter
    const clearBtn = page.locator('.action-btn', { hasText: 'Clear' });
    if (await clearBtn.isVisible().catch(() => false)) {
      await clearBtn.click();
    }
  });

  test('views an audit report with risk gauge and clauses', async ({ page }) => {
    // Ensure audit exists
    const contractVisible = await page.getByText('sample-dpa.txt').isVisible().catch(() => false);
    if (!contractVisible) {
      const fileInput = page.locator('input[type="file"][accept=".txt,.pdf,.docx"]').first();
      await fileInput.setInputFiles(FIXTURE_PATH);
      await expect(page.getByText('sample-dpa.txt')).toBeVisible({ timeout: 30000 });
    }

    // Click "View" on the first audit
    const viewBtn = page.locator('.action-btn', { hasText: 'View' }).first();
    await expect(viewBtn).toBeVisible({ timeout: 5000 });
    await viewBtn.click();

    // Report view should show risk information
    await expect(page.locator('h2', { hasText: 'Overall Risk' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('h2', { hasText: 'Clause Risk Scores' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Gap Report' })).toBeVisible();
    await expect(page.locator('h2', { hasText: 'Remediation Plan' })).toBeVisible();

    // Back to History button
    const backBtn = page.locator('.nav-btn', { hasText: 'Back to History' });
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Should return to audit history
    await expect(page.locator('h2', { hasText: 'Audit History' })).toBeVisible({ timeout: 5000 });
  });

  test('searches audits by contract name', async ({ page }) => {
    // Ensure audit exists
    const contractVisible = await page.getByText('sample-dpa.txt').isVisible().catch(() => false);
    if (!contractVisible) {
      const fileInput = page.locator('input[type="file"][accept=".txt,.pdf,.docx"]').first();
      await fileInput.setInputFiles(FIXTURE_PATH);
      await expect(page.getByText('sample-dpa.txt')).toBeVisible({ timeout: 30000 });
    }

    const searchInput = page.locator('input[placeholder="Search by contract name..."]');
    await searchInput.fill('sample-dpa');

    await page.waitForTimeout(1000);

    // Matching rows should still be visible
    const rows = page.locator('.scores-table tbody tr');
    const rowCount = await rows.count();
    if (rowCount > 0) {
      const firstName = await rows.first().locator('td').first().textContent();
      expect(firstName?.toLowerCase()).toContain('sample-dpa');
    }

    await searchInput.clear();
  });

  test('navigates to Settings page', async ({ page }) => {
    const settingsBtn = page.locator('.dash-nav-btn', { hasText: 'Settings' });
    await settingsBtn.click();

    // Settings page should load — look for tab buttons
    await expect(page.getByRole('button', { name: 'Webhooks' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Templates' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preferences' })).toBeVisible();

    // Click "Preferences" tab
    const prefsTab = page.locator('.nav-btn', { hasText: 'Preferences' });
    await prefsTab.click();

    // Preferences UI should show theme/digest options
    await expect(page.getByText(/email digest|theme/i).first()).toBeVisible({ timeout: 5000 });

    // Go back — the Settings page has an onBack that sets page='audits'
    const backBtn = page.locator('button', { hasText: /back|dashboard/i }).first();
    await backBtn.click();

    await expect(
      page.getByRole('heading', { name: 'Audit History' })
    ).toBeVisible({ timeout: 10000 });
  });

  test('navigates to Analytics page', async ({ page }) => {
    const analyticsBtn = page.locator('.dash-nav-btn', { hasText: 'Analytics' });
    if (await analyticsBtn.isVisible().catch(() => false)) {
      await analyticsBtn.click();
      // Analytics page should load
      await page.waitForTimeout(2000);

      // Back to dashboard
      const backBtn = page.locator('button', { hasText: /back|dashboard/i }).first();
      if (await backBtn.isVisible().catch(() => false)) {
        await backBtn.click();
        await expect(
          page.getByRole('heading', { name: 'Audit History' })
        ).toBeVisible({ timeout: 10000 });
      }
    }
  });

  test('signs out and returns to landing page', async ({ page }) => {
    const signOutBtn = page.locator('.dash-nav-btn.logout');
    await expect(signOutBtn).toContainText('Sign Out');
    await signOutBtn.click();

    // Should return to the landing page or auth page
    // Wait for either the landing nav "Sign In" button or auth card
    await expect(
      page.locator('button', { hasText: 'Sign In' }).first()
        .or(page.locator('.auth-card'))
    ).toBeVisible({ timeout: 10000 });
  });
});
