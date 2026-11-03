/** Journey A — authentication and authorization states in the real browser. */
import { test, expect } from '@playwright/test';
import { resetData, signIn, signInAs } from './fixtures';

test.beforeAll(resetData);

test('an unauthenticated visitor to a protected page is asked to sign in', async ({ page }) => {
  await page.goto('/dashboard/courses');
  await expect(page.getByText('Please sign in')).toBeVisible();
  await expect(page.getByText('E2E Live Course')).toHaveCount(0);
});

test('a student signs in, reaches their home, and loses access after signing out', async ({ page }) => {
  await signInAs(page, 'stu');
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page.getByText(/Please sign in|Sign in with the email/).first()).toBeVisible();
  await page.goto('/courses/e2e_course/lessons/e2e_plain');
  await expect(page.getByText('Please sign in')).toBeVisible();
  await expect(page.getByText('E2E Reading Lesson reading content.')).toHaveCount(0);
});

test('a suspended account is refused', async ({ page }) => {
  await signIn(page, 'suspended');
  await expect(page.getByText('Your account is paused')).toBeVisible();
  await page.goto('/dashboard/courses');
  await expect(page.getByText(/isn.t active|paused/).first()).toBeVisible();
  await expect(page.getByText('E2E Live Course')).toHaveCount(0);
});

test('a login without a profile is refused', async ({ page }) => {
  await signIn(page, 'noProfile');
  await expect(page.getByText(/isn.t set up yet/).first()).toBeVisible();
  await page.goto('/dashboard/courses');
  await expect(page.getByText(/isn.t set up yet/).first()).toBeVisible();
  await expect(page.getByText('E2E Live Course')).toHaveCount(0);
});

test('a student navigating directly to staff pages is refused', async ({ page }) => {
  await signInAs(page, 'stu');
  for (const path of ['/dashboard/courses', '/dashboard/courses/e2e_course/lessons/e2e_draft', '/dashboard/people']) {
    await page.goto(path);
    await expect(page.getByText("This area isn't available to you")).toBeVisible();
  }
});

test('the login redirect never leaves the academy (open-redirect fix)', async ({ page }) => {
  await page.goto('/login?redirect=//evil.example/steal');
  await page.locator('input[type="email"]').first().fill('e2e_stu@e2e.test');
  await page.locator('input[type="password"]').fill('e2e-only-Passw0rd!');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:3201\/dashboard/);
});
