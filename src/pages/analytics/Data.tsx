import { useCallback, useEffect, useState } from 'react';
import { dayMonthYear } from '@/lib/format';
import { Card } from './ui';

interface Status {
  dates: { label: string; date: string | null }[];
  webhook: boolean;
  changes: {
    since: string;
    total: number;
    capped: boolean;
    pages: number;
    latest: string | null;
    recent: { page: string; event: string; at: string }[];
  };
}

const DAY = 86_400_000;

/** "today", "yesterday", "5 days ago". */
function ago(day: string): string {
  const days = Math.floor((Date.now() - Date.parse(`${day}T00:00:00Z`)) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * `/analytics/data` — how old the Liquipedia data is and how much has changed on
 * the wiki since (`server/data-status.ts`). Updating is done on the laptop
 * (UPDATE_DATA.md).
 */
export function Data() {
  const [status, setStatus] = useState<Status | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/data');
    if (res.ok) setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!status) return <p className="muted">Loading…</p>;
  const { changes } = status;
  const exported = status.dates[0]?.date;

  return (
    <div className="stack">
      <Card
        title="Liquipedia data"
        aside={exported ? <span className="chip">{ago(exported)}</span> : null}
      >
        <ul className="small stack-sm list-reset">
          {status.dates.map((entry) => (
            <li key={entry.label}>
              {entry.label}: <strong>{entry.date ? dayMonthYear(entry.date) : 'no date'}</strong>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Changed on Liquipedia since">
        {status.webhook ? (
          <div className="stack-sm">
            <p className="small" style={{ margin: 0 }}>
              <strong>
                {changes.total.toLocaleString()}
                {changes.capped ? '+' : ''}
              </strong>{' '}
              edits to <strong>{changes.pages.toLocaleString()}</strong> Fortnite pages since{' '}
              {dayMonthYear(changes.since)}
              {changes.latest ? `, the latest ${new Date(changes.latest).toLocaleString()}` : ''}.
            </p>
            {changes.recent.length ? (
              <ul className="tiny faint list-reset stack-sm">
                {changes.recent.map((change, i) => (
                  <li key={`${change.page}-${i}`}>
                    {change.page.replace(/_/g, ' ')} · {change.event} · {new Date(change.at).toLocaleString()}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            The webhook is off: set <code>LIQUIPEDIA_WEBHOOK_SECRET</code> on the server and give Liquipedia the URL
            (UPDATE_DATA.md, "webhooks"). Then this counts the pages edited since the export.
          </p>
        )}
      </Card>

    </div>
  );
}
