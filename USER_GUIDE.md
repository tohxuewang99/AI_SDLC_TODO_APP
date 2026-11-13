# Todo App User Guide

## Todos

The home page lists your todos in **Overdue**, **Pending**, and **Completed**
sections. Add a todo with a title; priority defaults to Medium, and a due date
is optional. Due dates are entered and shown in Singapore time, and new due
dates must be at least one minute in the future.

Priority badges use red for High, yellow for Medium, and blue for Low. Overdue
and Pending todos are ordered by priority, then earliest due date (todos
without a due date come last), then newest creation date. Completed todos stay
ordered by completion time. Use the **Priority** filter to show one priority or
choose **All Priorities** to show everything; changing a todo's priority updates
the current list immediately.

Use **Search** to find text in todo or subtask titles; matching ignores case and
updates after a short pause. Combine search with the **Priority** and **Tags**
filters. **Advanced** adds completion and due-date range filters. Active filters
can be cleared together or saved as named presets in this browser; saved presets
are not synced to other devices. Empty sections are hidden, and the page
distinguishes an empty todo list from a filter with no matches.

Use the checkbox to complete or reopen a todo. Choose **Edit** to change its
title, priority, or due date; canceling or dismissing the edit leaves it
unchanged. **Delete** removes a todo immediately. Todo data is private to the
signed-in account.

## Templates

Save a draft or an existing todo as a template, then use **Use Template** or
the **Templates** manager to create a fresh todo. Templates can include a
checklist and an optional due-date offset in minutes; recurring templates and
reminders require an offset. Tags are not copied. Deleting a template does not
change todos already created from it.

## Backup and restore

Choose **Export JSON** to download a backup of all your todos, including their
subtasks and tags. **Export CSV** downloads a spreadsheet-friendly list but
cannot be imported. Downloads use the current Singapore date in their filenames.

Choose **Import** and select an exported JSON file. Import adds new todos rather
than merging with existing ones, so importing the same file twice creates
duplicates. Matching tag names are reused without changing their existing color.
The list refreshes when the import completes. Files larger than 10 MB may take
longer; an invalid file is rejected without making partial changes.

## Reminders and browser notifications

Choose **Enable Notifications** to opt in to the browser permission prompt.
With permission granted, **Notifications On** is shown and the app checks
reminders every 30 seconds while the home page is open. In browsers without
notification support the control is disabled; blocked permission must be changed
in this site's browser settings.

Set a due date to enable **Reminder** in the add form or editor. Choose None,
15 minutes, 30 minutes, 1 hour, 2 hours, 1 day, 2 days, or 1 week before due.
The bell badge shows 15m, 30m, 1h, 2h, 1d, 2d, or 1w. Removing a due date also
removes its reminder. Changing the due date or reminder timing resets delivery
state so the new window can notify again; recurring instances inherit timing
but start with fresh delivery state.

Following PRP 00's bounded window, reminders are eligible from the selected
offset through the due time, inclusive; reminders missed after that are not
delivered. There is no service worker or server push: a closed tab/browser cannot
deliver reminders, and background-tab throttling can delay the 30-second check.
The browser/OS decides notification persistence. Server-side delivery stamps
prevent repeat polling alerts after acknowledgement; multiple tabs can race
before acknowledgement, so exactly-once delivery is best effort, not guaranteed.
Delivery failures appear on the page and are retried at the next polling tick.

## Calendar

Choose **Calendar** on the home page. The calendar always shows six weeks,
Sunday to Saturday, with adjacent-month days dimmed, weekends shaded, and today
highlighted. All dates use Singapore time, regardless of your device timezone.
**Previous month**, **Next month**, and **Today** update the bookmarkable
`?month=YYYY-MM` address. Choose **Todo App** to return to the list.

Todos appear on their due dates, with the same priority colors as the list.
Completed todos remain visible with a line through their title. Undated todos
do not appear, and the list's priority filter does not restrict the calendar.
Only three todos appear in each cell; **+X more** shows the remaining count.
Select any date to read all its todos and holiday; press **Close** or Escape
to dismiss the dialog. The calendar is read-only: edit todos from the list.

An administrator must run `npm run seed:holidays` to load Singapore public
holidays for 2025–2027. Sunday replacement holidays apply when Sunday is your
rest day. Dates outside those years still work, but holidays are not seeded.

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

## Todo basics and recurring tasks

After signing in, enter a title to create a todo. Priority defaults to Medium;
you can also set a due date and choose High, Medium, or Low. Due dates use
Singapore local time and must be at least one minute in the future.

To repeat a todo, set its due date, select **Repeat**, and choose Daily, Weekly,
Monthly, or Yearly. Completing a recurring todo creates its next instance with
the current title, priority, reminder setting, pattern, and tags. Monthly dates
that do not exist in the next month are clamped to that month's last day; a
yearly February 29 occurrence becomes February 28 in a non-leap year. Turn off
**Repeat** in the todo editor to stop future instances.

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
