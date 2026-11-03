import { test, expect, type Page } from '@playwright/test'

async function accessInstance(page: Page, options: { fail?: boolean; session?: boolean } = {}) {
  const writes: string[] = []
  const user = { id: 'founder', email: 'max@ontora.com', role: 'admin', verified: true, created_at: new Date().toISOString() }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (!path.startsWith('/api/')) return route.continue()
    if (route.request().method() !== 'GET') writes.push(path)
    let status = 200
    let body: unknown = {}
    if (path === '/api/config/public') body = { auth_mode: 'cloudflare' }
    else if (path === '/api/features') body = { password_auth: false, user_management: true }
    else if (path === '/api/auth/refresh') { status = options.session ? 200 : 401; body = options.session ? { access_token: 'synthetic', user } : { error: 'No session' } }
    else if (path === '/api/auth/access') { status = options.fail ? 401 : 200; body = options.fail ? { error: 'Sign in with an authorized Ontora Google account.' } : { access_token: 'synthetic', user } }
    else if (path === '/api/auth/onboarding/status') body = { onboarding_completed: true }
    else if (path === '/api/users') body = { users: [user] }
    else if (path === '/api/users/invites') body = { invites: [] }
    else if (path === '/api/orgs') body = []
    else if (path === '/api/billing/status') body = { status: 'none', plan: 'none' }
    else if (path === '/api/queue') body = { entries: [], total: 0 }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return writes
}

test('founder opens a session through Google without a password or email verification', async ({ page }) => {
  const writes = await accessInstance(page)
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Continue with Ontora Google' })).toBeVisible()
  await expect(page.locator('input[type=password]')).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath('ontora-login.png'), fullPage: true })
  await page.getByRole('button', { name: 'Continue with Ontora Google' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
  expect(writes).toContain('/api/auth/access')
  expect(writes.filter(path => /register|verify|google\/login/.test(path))).toEqual([])
})

test('an unauthorized account gets a recoverable error without a session', async ({ page }) => {
  await accessInstance(page, { fail: true })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Continue with Ontora Google' }).click()
  await expect(page.getByRole('alert')).toContainText('authorized Ontora Google account')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('link', { name: 'Use a different Google account' })).toHaveAttribute('href', '/cdn-cgi/access/logout')
})

test('legacy signup and verification links lead to Google login', async ({ page }) => {
  const writes = await accessInstance(page)
  for (const path of ['/register', '/join?token=old', '/check-email', '/verify-email', '/magic-link', '/reset-password']) {
    await page.goto(path)
    await expect(page.getByRole('button', { name: 'Continue with Ontora Google' })).toBeVisible()
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('input[type=password]')).toHaveCount(0)
  }
  expect(writes.filter(path => /register|verify|magic\/local/.test(path))).toEqual([])
})

test('SSO administrators manage roles without issuing password invitations', async ({ page }) => {
  await accessInstance(page, { session: true })
  await page.goto('/dashboard/users')
  await expect(page.getByRole('heading', { name: 'Ontora Google access' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create invitation' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Accounts (1)' })).toBeVisible()
})
