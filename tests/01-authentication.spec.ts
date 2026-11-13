import { expect, test, type CDPSession, type Page } from '@playwright/test';

const virtualAuthenticatorOptions = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

function uniqueUsername(): string {
  return `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const authenticatorsByPage = new WeakMap<
  Page,
  { cdp: CDPSession; authenticatorId: string }
>();

async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: virtualAuthenticatorOptions,
  });
  return { cdp, authenticatorId };
}

async function register(page: Page, username: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: `Welcome, ${username}` })).toBeVisible();
}

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL('/login');
}

test.beforeEach(async ({ page }) => {
  authenticatorsByPage.set(page, await addVirtualAuthenticator(page));
});

test('registers a new user and redirects to the protected home page', async ({ page }) => {
  const username = uniqueUsername();
  await register(page, username);
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me');
    return {
      status: response.status,
      body: await response.json(),
    };
  });
  expect(me.status).toBe(200);
  expect(me.body.user.username).toBe(username);
});

test('rejects a replayed registration challenge', async ({ page }) => {
  const username = uniqueUsername();
  let verificationBody: string | null = null;
  page.on('request', (request) => {
    if (
      request.url().endsWith('/api/auth/register-verify') &&
      request.method() === 'POST'
    ) {
      verificationBody = request.postData();
    }
  });
  await register(page, username);
  expect(verificationBody).not.toBeNull();

  const replay = await page.evaluate(async (body) => {
    const response = await fetch('/api/auth/register-verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return {
      status: response.status,
      result: await response.json(),
    };
  }, verificationBody);

  expect(replay.status).toBe(401);
  expect(replay.result.error).toBe('Registration challenge expired or was already used.');
});

test('rejects duplicate usernames before a second registration', async ({ page }) => {
  const username = uniqueUsername();
  await register(page, username);
  await logout(page);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText('Username already taken.');
  await expect(page).toHaveURL('/login');
});

test('logs in with a previously registered passkey', async ({ page }) => {
  const username = uniqueUsername();
  await register(page, username);
  await logout(page);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL('/');
});

test('shows an error for an unregistered username', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Username').fill(uniqueUsername());
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText(
    'Unable to start passkey login for that account.',
  );
  await expect(page).toHaveURL('/login');
});

test('logout clears the session and protects the home page', async ({ page }) => {
  await register(page, uniqueUsername());
  await logout(page);
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/auth/me');
    return response.status;
  });
  expect(me).toBe(401);
  await page.goto('/');
  await expect(page).toHaveURL('/login');
});

test('session survives a full page reload', async ({ page }) => {
  await register(page, uniqueUsername());
  await page.reload();
  await expect(page).toHaveURL('/');
});

test('redirects unauthenticated visits to the calendar', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page).toHaveURL('/login');
});

test('redirects an authenticated user away from the login page', async ({ page }) => {
  await register(page, uniqueUsername());
  await page.goto('/login');
  await expect(page).toHaveURL('/');
});

test('adds a second device passkey and logs in with it', async ({ page }) => {
  const username = uniqueUsername();
  const firstDevice = authenticatorsByPage.get(page);
  if (!firstDevice) {
    throw new Error('Virtual authenticator was not initialized.');
  }
  const { cdp, authenticatorId: firstAuthenticatorId } = firstDevice;
  await register(page, username);

  const { authenticatorId: secondAuthenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        ...virtualAuthenticatorOptions,
        transport: 'usb',
      },
    },
  );
  await page.getByRole('button', { name: 'Add another passkey' }).click();
  await expect(page.getByRole('status')).toHaveText('Passkey added to your account.');
  await cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: firstAuthenticatorId,
  });
  await logout(page);
  await page.getByLabel('Username').fill(username);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL('/');
  await cdp.send('WebAuthn.removeVirtualAuthenticator', {
    authenticatorId: secondAuthenticatorId,
  });
});
