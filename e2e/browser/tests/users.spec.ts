import { test, expect, type Page } from '@playwright/test'

type Role = 'admin' | 'member'
async function mockInstance(page: Page, role: Role | null = 'admin', options: { failList?: boolean; failRole?: boolean } = {}) {
  const now = new Date().toISOString()
  let users = [
    { id: 'admin-1', email: 'admin@example.test', role: 'admin', verified: true, created_at: now },
    { id: 'member-1', email: 'member@example.test', role: 'member', verified: false, created_at: now },
  ]
  let invites: { id: string; email: string; role: string; created_at: string; expires_at: string }[] = []
  const writes: { path: string; method: string; body: unknown }[] = []
  const reads: string[] = []
  await page.route('**/api/**', async route => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (!path.startsWith('/api/')) return route.continue()
    const method = req.method()
    if (method !== 'GET') writes.push({ path, method, body: req.postDataJSON() })
    else reads.push(path)
    let status = 200
    let body: unknown = {}
    if (path === '/api/config/public') body = { auth_mode: 'password' }
    else if (path === '/api/features') body = { password_auth: true, user_management: true }
    else if (path === '/api/auth/refresh') {
      status = role ? 200 : 401
      body = role ? { access_token: 'synthetic-token', user: { ...users[0], role } } : { error: 'No session' }
    }
    else if (path === '/api/auth/onboarding/status') body = { onboarding_completed: true }
    else if (path === '/api/users' && options.failList) { status = 503; body = { error: 'User directory unavailable' } }
    else if (path === '/api/users') body = { users }
    else if (path === '/api/users/invites' && method === 'GET') body = { invites }
    else if (path === '/api/users/invites' && method === 'POST') {
      const { email } = req.postDataJSON()
      const invite = { id: 'invite-1', email, role: 'member', created_at: now, expires_at: new Date(Date.now() + 48 * 3600000).toISOString() }
      invites = [invite]
      body = { ...invite, invite_url: 'http://127.0.0.1:4178/join?token=cvinv_synthetic' }
      status = 201
    }
    else if (path === '/api/users/invites/invite-1' && method === 'DELETE') { invites = []; status = 204 }
    else if (path === '/api/users/member-1/role') {
      if (options.failRole) { status = 403; body = { error: 'Role change denied' } }
      else { const { role: newRole } = req.postDataJSON(); users = users.map(u => u.id === 'member-1' ? { ...u, role: newRole } : u); body = { id: 'member-1', role: newRole } }
    }
    else if (path === '/api/users/member-1' && method === 'DELETE') { users = users.filter(u => u.id !== 'member-1'); status = 204 }
    else if (path === '/api/auth/register') { status = 201; body = { status: 'pending_verification', user_id: 'new-user', email: req.postDataJSON().email } }
    else if (path === '/api/billing/status') body = { status: 'none', plan: 'none' }
    else if (path === '/api/queue') body = { entries: [], total: 0 }
    else if (path === '/api/orgs') body = []
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? undefined : JSON.stringify(body) })
  })
  return { writes, reads }
}

test('admin creates a member invite and can revoke it without sending email', async ({ page }) => {
  const { writes } = await mockInstance(page)
  await page.goto('/dashboard/users')
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill('invitee@example.test')
  await page.getByRole('button', { name: 'Create invitation' }).click()
  await expect(page.getByLabel('Invitation link')).toHaveValue(/\/join\?token=cvinv_synthetic$/)
  await page.screenshot({ path: test.info().outputPath('users.png'), fullPage: true })
  expect(writes.find(w => w.path === '/api/users/invites')?.body).toEqual({ email: 'invitee@example.test', role: 'member' })
  await page.getByRole('button', { name: 'Revoke invitation for invitee@example.test' }).click()
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('No pending invitations.')).toBeVisible()
  await expect(page.getByLabel('Invitation link')).toHaveCount(0)
  expect(writes.filter(w => /email|send/.test(w.path))).toEqual([])
})

test('role changes and removal require confirmation; own admin is protected', async ({ page }) => {
  const { writes } = await mockInstance(page)
  await page.goto('/dashboard/users')
  await expect(page.getByLabel('Role for admin@example.test')).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove admin@example.test' })).toBeDisabled()
  await page.getByLabel('Role for member@example.test').selectOption('admin')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(writes.filter(w => w.method === 'PUT')).toHaveLength(0)
  await page.getByLabel('Role for member@example.test').selectOption('admin')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByLabel('Role for member@example.test')).toHaveValue('admin')
  await page.getByRole('button', { name: 'Remove member@example.test' }).click()
  expect(writes.filter(w => w.method === 'DELETE')).toHaveLength(0)
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Accounts (1)' })).toBeVisible()
})

test('members cannot load the admin screen or user directory', async ({ page }) => {
  const { reads } = await mockInstance(page, 'member')
  await page.goto('/dashboard/users')
  await expect(page.getByText('User management is available to instance administrators only.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0)
  expect(reads.filter(p => p.startsWith('/api/users'))).toEqual([])
})

test('load and mutation errors stay visible instead of reporting success', async ({ page }) => {
  await mockInstance(page, 'admin', { failRole: true })
  await page.goto('/dashboard/users')
  await page.getByLabel('Role for member@example.test').selectOption('admin')
  await page.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Role change denied')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByLabel('Role for member@example.test')).toHaveValue('member')
})

test('directory failure is an error, not an empty user list', async ({ page }) => {
  await mockInstance(page, 'admin', { failList: true })
  await page.goto('/dashboard/users')
  await expect(page.getByRole('alert')).toContainText('User directory unavailable')
  await expect(page.getByRole('heading', { name: 'Accounts (0)' })).toHaveCount(0)
})

test('invite acceptance passes the token and keeps unverified users signed out', async ({ page }) => {
  const { writes } = await mockInstance(page, null)
  await page.goto('/join?token=cvinv_synthetic')
  await page.getByLabel('Email', { exact: true }).fill('invitee@example.test')
  await page.getByLabel('Password', { exact: true }).fill('synthetic-test-password')
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page.getByText('Account awaiting verification')).toBeVisible()
  expect(writes.find(w => w.path === '/api/auth/register')?.body).toEqual({ email: 'invitee@example.test', password: 'synthetic-test-password', invite_token: 'cvinv_synthetic' })
  await expect(page).toHaveURL(/\/join\?token=/)
})

test('incomplete invite link never creates an account', async ({ page }) => {
  const { writes } = await mockInstance(page, null)
  await page.goto('/join')
  await expect(page.getByRole('alert')).toContainText('incomplete')
  expect(writes.filter(w => w.path === '/api/auth/register')).toEqual([])
})
