'use client';

import { useRef, useState, type ChangeEvent } from 'react';

export default function ExportImportToolbar({ onImported }: { onImported: () => Promise<void> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [largeFile, setLargeFile] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setLargeFile(file.size > 10 * 1024 * 1024);
    setMessage(null);
    try {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error('Invalid JSON format');
      }
      const response = await fetch('/api/todos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as { imported?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Failed to import todos');
      try {
        await onImported();
        setMessage({ error: false, text: `Successfully imported ${result.imported} todos` });
      } catch {
        setMessage({
          error: true,
          text: `Successfully imported ${result.imported} todos, but the list could not refresh. Reload the page; do not re-import.`,
        });
      }
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : 'Failed to import todos' });
    } finally {
      setImporting(false);
      setLargeFile(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <section aria-label="Export and import" className="mb-6">
      <div className="flex flex-wrap gap-2">
        <form action="/api/todos/export" method="get">
          <button className="rounded-xl bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800" name="format" type="submit" value="json">Export JSON</button>
        </form>
        <form action="/api/todos/export" method="get">
          <button className="rounded-xl bg-emerald-900 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-950" name="format" type="submit" value="csv">Export CSV</button>
        </form>
        <button className="rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50" disabled={importing} onClick={() => inputRef.current?.click()} type="button">
          {importing ? 'Importing…' : 'Import'}
        </button>
        <input ref={inputRef} aria-label="Import JSON file" accept="application/json,.json" className="sr-only" onChange={(event) => void importFile(event)} type="file" />
      </div>
      <p className="mt-2 text-xs text-slate-600">Import creates new todos and does not merge with existing ones. CSV cannot be imported.</p>
      {largeFile && <p className="mt-2 text-sm text-amber-800" role="status">This large file may take a while to import.</p>}
      {message && <p className={`mt-2 text-sm ${message.error ? 'text-red-700' : 'text-green-700'}`} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    </section>
  );
}
