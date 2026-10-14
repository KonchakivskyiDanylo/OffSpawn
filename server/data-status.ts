import type { Store } from './store';

/**
 * How old the Liquipedia data is (the user, 14 Oct 2026: "at least tell when
 * the data was taken the last time"). The site's data is files in git, built
 * on the laptop from a 500 MB raw dump (UPDATE_DATA.md); this page only says
 * when that last happened and how far behind it is. How far comes from the
 * Liquipedia webhook's pings, which the server already keeps: every Fortnite
 * page edited since the export.
 *
 * An Update button that ran the update on GitHub Actions was built and taken
 * out the same day (the user: "drop it… I would update by myself then"): its
 * first run would have had to fetch the whole dump, about eight hours.
 */

/** Pings counted at most; past this the page says "5,000+". */
const MAX_CHANGES = 5_000;

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
}

export async function dataStatus(
  store: Store,
  data: { exportDate: string; files: { label: string; date: string | null }[]; webhook: boolean },
): Promise<DataStatus> {
  const since = new Date(`${data.exportDate}T00:00:00Z`);
  const pings = await store.pageChangesSince(since, MAX_CHANGES);
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
  };
}
