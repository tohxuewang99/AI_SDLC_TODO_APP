# Todo App User Guide

## Todos

The home page lists your todos in **Overdue**, **Pending**, and **Completed**
sections. Add a todo with a title; priority defaults to Medium, and a due date
is optional. Due dates are entered and shown in Singapore time, and new due
dates must be at least one minute in the future.

Use the checkbox to complete or reopen a todo. Choose **Edit** to change its
title, priority, or due date; canceling or dismissing the edit leaves it
unchanged. **Delete** removes a todo immediately. Todo data is private to the
signed-in account.

## Passkey accounts

This app uses WebAuthn passkeys only. It does not store passwords. A passkey may
use a device biometric, device PIN, or an external security key.

### Register

1. Open `/login`.
2. Enter a username and choose **Register**.
3. Approve the browser's passkey prompt.
4. The app creates the account and signs you in.

Usernames are case-insensitive and cannot be registered twice.

### Log in

1. Open `/login` and enter the username used at registration.
2. Choose **Login** and approve the passkey prompt.

Login does not reveal whether another username is registered. A canceled passkey
prompt leaves the username in place so you can retry.

### Add another device

While signed in, choose **Add another passkey** and complete the passkey prompt
on the additional device. Login accepts any passkey registered to the account.
Registering the same username from a signed-out session is rejected.

### Log out and sessions

Choose **Log out** to clear the session cookie. Sessions use an HTTP-only,
SameSite=Lax cookie with a seven-day expiry and are protected by a signed JWT.
The home and calendar routes redirect to `/login` if the session is missing,
expired, or invalid.

### Account recovery

There is currently no recovery flow if every passkey for an account is lost.
Register another device while you still have access to the account.

## Local configuration

Set `SESSION_SECRET` to a random secret of at least 32 bytes. Configure
`RP_NAME`, `RP_ID`, and `RP_ORIGIN` to match the site where passkeys will be
used. For local development, use `Todo App`, `localhost`, and
`http://localhost:3000`, respectively. Changing the site origin after
registration can make existing passkeys unusable.
