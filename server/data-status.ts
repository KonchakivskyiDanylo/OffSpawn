import type { Store } from './store';

/**
 * How old the Liquipedia data is, and an Update button that refreshes it
 * without the laptop (the user, 14 Oct 2026: "at least tell when the data was
 * taken the last time? Or maybe even create some buttons so I click and it
 * updates").
 *
 * The site's data is files in git, built from a 500 MB raw dump that only
 * lives where the update last ran — so the server cannot rebuild it itself.
 * The button starts `.github/workflows/update-data.yml` instead: GitHub
 * Actions keeps the raw dump in its cache, runs the same two scripts as
 * UPDATE_DATA.md, runs the checks and commits the new files, and Heroku
 * deploys the commit like any other.
 *
 * How far behind the data is comes from the Liquipedia webhook's pings, which
 * the server already keeps: every Fortnite page edited since the export.
 *
 * Configuration, environment variables (all optional; without them the page
 * shows the dates and says what the button needs):
 *   DATA_UPDATE_TOKEN   a GitHub fine-grained token for the repository with
 *                       "Actions: read and write"
 *   DATA_UPDATE_REPO    "owner/name" of the repository
 *   DATA_UPDATE_BRANCH  the branch the workflow runs on; main by default
 */

const TOKEN = process.env.DATA_UPDATE_TOKEN ?? '';
const REPO = process.env.DATA_UPDATE_REPO ?? '';
const BRANCH = process.env.DATA_UPDATE_BRANCH || 'main';
const WORKFLOW = 'update-data.yml';
/** Pings counted at most; past this the page says "5,000+". */
const MAX_CHANGES = 5_000;

export interface UpdateRun {
  /** queued, in_progress, completed… as GitHub says. */
  status: string;
  /** success, failure, cancelled… once completed. */
  conclusion: string | null;
  started: string;
  updated: string;
  url: string;
  /** workflow_dispatch (the button) or schedule (the weekly run). */
  trigger: string;
}

export interface DataStatus {
  /** `EXPORT_DATE` and the files' own `generated` dates, "YYYY-MM-DD". */
  dates: { label: string; date: string | null }[];
  webhook: boolean;
  /** Pings since the export date: how many, how many pages, the newest few. */
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

const github = (pathname: string, init: RequestInit = {}) =>
  fetch(`https://api.github.com/repos/${REPO}${pathname}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'OffSpawn data updater',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  });

async function latestRun(): Promise<{ run: UpdateRun | null; error: string | null }> {
  if (!TOKEN || !REPO) return { run: null, error: null };
  try {
    const res = await github(`/actions/workflows/${WORKFLOW}/runs?per_page=1`);
    if (!res.ok) return { run: null, error: `GitHub answered ${res.status} for the workflow's runs` };
    const body = (await res.json()) as { workflow_runs?: Record<string, unknown>[] };
    const run = body.workflow_runs?.[0];
    if (!run) return { run: null, error: null };
    return {
      run: {
        status: String(run.status),
        conclusion: run.conclusion ? String(run.conclusion) : null,
        started: String(run.run_started_at ?? run.created_at),
        updated: String(run.updated_at),
        url: String(run.html_url),
        trigger: String(run.event),
      },
      error: null,
    };
  } catch (error) {
    return { run: null, error: (error as Error).message };
  }
}

export async function dataStatus(
  store: Store,
  data: { exportDate: string; files: { label: string; date: string | null }[]; webhook: boolean },
): Promise<DataStatus> {
  const since = new Date(`${data.exportDate}T00:00:00Z`);
  const pings = await store.pageChangesSince(since, MAX_CHANGES);
  const { run, error } = await latestRun();
  return {
    dates: [{ label: 'Liquipedia export', date: data.exportDate }, ...data.files],
    webhook: data.webhook,
    changes: {
      since: data.exportDate,
      total: pings.length,
      capped: pings.length >= MAX_CHANGES,
      pages: new Set(pings.map((ping) => ping.body.page)).size,
      latest: pings[0]?.at ?? null,
      recent: pings.slice(0, 12).map((ping) => ({ page: ping.body.page, event: ping.body.event, at: ping.at })),
    },
    updater: { configured: Boolean(TOKEN && REPO), repo: REPO, branch: BRANCH, run, error },
  };
}

/** Starts the update workflow. Throws with GitHub's reason when it refuses. */
export async function startDataUpdate(): Promise<void> {
  if (!TOKEN || !REPO) throw new Error('Set DATA_UPDATE_TOKEN and DATA_UPDATE_REPO on the server first');
  const res = await github(`/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: BRANCH }),
  });
  if (!res.ok) throw new Error(`GitHub refused to start the update (${res.status}): ${(await res.text()).slice(0, 200)}`);
}
