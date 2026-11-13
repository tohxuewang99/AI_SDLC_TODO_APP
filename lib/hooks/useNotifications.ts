'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Todo } from '@/lib/db';
import { formatSingaporeDateTime, getSingaporeNow } from '@/lib/timezone';

type Permission = NotificationPermission | 'unsupported';
const permissionEvent = 'todo-notification-permission';

function getPermission(): Permission {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function subscribePermission(onChange: () => void) {
  window.addEventListener('focus', onChange);
  window.addEventListener(permissionEvent, onChange);
  document.addEventListener('visibilitychange', onChange);
  const timer = window.setInterval(onChange, 30_000);
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener(permissionEvent, onChange);
    document.removeEventListener('visibilitychange', onChange);
    window.clearInterval(timer);
  };
}

export function useNotifications() {
  const permission = useSyncExternalStore(subscribePermission, getPermission, () => 'default');
  const [error, setError] = useState<string | null>(null);

  const requestPermission = useCallback(async () => {
    try {
      if (!('Notification' in window)) {
        throw new Error('This browser does not support notifications.');
      }
      await Notification.requestPermission();
      window.dispatchEvent(new Event(permissionEvent));
      setError(null);
    } catch (requestError) {
      console.error('Notification permission request failed', requestError);
      setError(requestError instanceof Error ? requestError.message : 'Could not enable notifications.');
    }
  }, []);

  useEffect(() => {
    if (permission !== 'granted') return;

    const controller = new AbortController();
    const shown = new Map<string, string>();
    let polling = false;

    async function poll() {
      if (polling || controller.signal.aborted) return;
      window.dispatchEvent(new Event(permissionEvent));
      if (getPermission() !== 'granted') return;
      polling = true;
      try {
        const response = await fetch('/api/notifications/check', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error('Could not check reminders. Check your connection and sign-in.');
        }
        const result: { success: boolean; data: Todo[] } = await response.json();
        if (result.success !== true || !Array.isArray(result.data)) {
          throw new Error('The reminder server returned an invalid response.');
        }
        const pendingKeys = new Set(result.data.map((todo) => (
          JSON.stringify([todo.id, todo.due_date, todo.reminder_minutes])
        )));
        for (const key of shown.keys()) {
          if (!pendingKeys.has(key)) shown.delete(key);
        }

        for (const todo of result.data) {
          if (controller.signal.aborted || getPermission() !== 'granted') break;
          if (todo.due_date === null || todo.reminder_minutes === null) {
            throw new Error('The reminder server returned a todo without reminder settings.');
          }
          const key = JSON.stringify([todo.id, todo.due_date, todo.reminder_minutes]);
          let sentAt = shown.get(key);
          if (!sentAt) {
            const notification = new Notification(todo.title, {
              body: `Due ${formatSingaporeDateTime(todo.due_date)}`,
              tag: `todo-${todo.id}`,
            });
            notification.onclick = () => {
              window.focus();
              notification.close();
            };
            sentAt = getSingaporeNow().toISOString();
            shown.set(key, sentAt);
          }
          const acknowledgement = await fetch(`/api/todos/${todo.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              last_notification_sent: sentAt,
              notification_due_date: todo.due_date,
              notification_reminder_minutes: todo.reminder_minutes,
            }),
          });
          if (!acknowledgement.ok) {
            throw new Error('Could not save reminder delivery. It will be retried on the next check.');
          }
          shown.delete(key);
        }
        if (!controller.signal.aborted) setError(null);
      } catch (pollError) {
        if (!controller.signal.aborted) {
          console.error('Reminder polling failed', pollError);
          setError(pollError instanceof Error ? pollError.message : 'Could not deliver reminders.');
        }
      } finally {
        polling = false;
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 30_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [permission]);

  return { permission, requestPermission, error };
}
