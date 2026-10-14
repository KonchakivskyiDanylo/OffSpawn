import { useCallback, useEffect, useState } from 'react';
import { dayMonthYear } from '@/lib/format';
import { Card } from './ui';

interface UpdateRun {
  status: string;
  conclusion: string | null;
  started: string;
  updated: string;
  url: string;
  trigger: string;
}

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
  updater: { configured: boolean; repo: string; branch: string; run: UpdateRun | null; error: string | null };
}

const DAY = 86_400_000;

/** "today", "yesterday", "5 days ago". */
function ago(day: string): string {
  const days = Math.floor((Date.now() - Date.parse(`${day}T00:00:00Z`)) / DAY);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

function runLabel(run: UpdateRun): { text: string; tone: string } {
  if (run.status !== 'completed') return { text: run.status === 'queued' ? 'Queued' : 'Running…', tone: 'chip' };
  if (run.conclusion === 'success') return { text: 'Last run worked', tone: 'chip chip--success' };
  return { text: `Last run: ${run.conclusion ?? 'unknown'}`, tone: 'chip chip--danger' };
}

/**
 * `/analytics/data` — how old the Liquipedia data is, how much has changed on
 * the wiki since, and the button that updates it from GitHub Actions
 * (`server/data-status.ts`).
 */
export function Data() {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/data');
    if (res.ok) setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const update = async () => {
    setStarting(true);
    const res = await fetch('/api/admin/data/update', { method: 'POST' });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setStarting(false);
    setMessage(
      res.ok
        ? { text: 'Started. It takes about ten minutes, then Heroku deploys the new data.', error: false }
        : { text: body.error ?? `Failed (${res.status})`, error: true },
    );
    window.setTimeout(() => void load(), 4000);
  };

  if (!status) return <p className="muted">Loading…</p>;
  const { changes, updater } = status;
  const exported = status.dates[0]?.date;
  const running = updater.run && updater.run.status !== 'completed';

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

      <Card
        title="Update"
        aside={updater.run ? <span className={runLabel(updater.run).tone}>{runLabel(updater.run).text}</span> : null}
      >
        {updater.configured ? (
          <div className="stack-sm">
            <p className="small" style={{ margin: 0 }}>
              Runs the update on GitHub Actions ({updater.repo}, {updater.branch}): fetches what changed on Liquipedia,
              rebuilds the data, runs the checks and commits it. Heroku then deploys it.
            </p>
            {updater.run ? (
              <p className="tiny faint" style={{ margin: 0 }}>
                Last run started {new Date(updater.run.started).toLocaleString()} (
                {updater.run.trigger === 'schedule' ? 'weekly' : 'by hand'}) ·{' '}
                <a href={updater.run.url} target="_blank" rel="noreferrer">
                  open on GitHub
                </a>
              </p>
            ) : null}
            <div className="row">
              <button type="button" className="btn btn--primary" disabled={starting || Boolean(running)} onClick={() => void update()}>
                {running ? 'Updating…' : starting ? 'Starting…' : 'Update now'}
              </button>
            </div>
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            Not set up yet. Set <code>DATA_UPDATE_TOKEN</code> and <code>DATA_UPDATE_REPO</code> on the server and the
            workflow's secrets on GitHub (UPDATE_DATA.md, "Updating from the dashboard").
          </p>
        )}
        {updater.error ? (
          <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>
            {updater.error}
          </p>
        ) : null}
        {message ? (
          <p className="small" style={{ color: message.error ? 'var(--danger)' : undefined, margin: 0 }}>
            {message.text}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
