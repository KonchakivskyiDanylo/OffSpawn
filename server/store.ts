import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { DailySet } from '@/daily/types';
import type { Platform } from '@/data/socials';
import type {
  ClientError,
  FunnelCount,
  RoundRecord,
  Stored,
  StoredSupport,
  SupportRequest,
  SupportStatus,
} from '@/analytics/types';

/**
 * One LiquipediaDB webhook ping, as Liquipedia sent it: a page on the wiki was
 * edited (or created), purged, deleted or moved. `from_*` only on a move.
 */
export interface PageChange {
  event: 'edit' | 'purge' | 'delete' | 'move';
  wiki: string;
  page: string;
  namespace: number;
  from_page?: string;
  from_namespace?: number;
}

/**
 * Where the server keeps what the site sends.
 *
 * Postgres when `DATABASE_URL` is set — Heroku sets it when a Postgres add-on
 * is attached — and a folder of JSON-lines files otherwise, so the whole thing
 * runs on a laptop with nothing installed. Both keep the record exactly as it
 * arrived; the dashboard is computed from it on request (`aggregate.ts`).
 */
export interface Store {
  addRound(body: RoundRecord): Promise<void>;
  /** Oldest first. `since` limits it, for the dashboard's day filter. */
  rounds(since?: Date): Promise<Stored<RoundRecord>[]>;
  /** Adds one to an hour's count of page opens or round starts — totals only, never a row per visit. */
  addFunnel(key: Omit<FunnelCount, 'n'>): Promise<void>;
  /** The counts from the hour `since` falls in on. */
  funnel(since?: Date): Promise<FunnelCount[]>;
  addSupport(body: SupportRequest): Promise<void>;
  /** Newest first. */
  support(): Promise<StoredSupport[]>;
  setSupportStatus(id: number, status: SupportStatus): Promise<boolean>;
  addError(body: ClientError): Promise<void>;
  /** Newest first. */
  errors(limit: number): Promise<Stored<ClientError>[]>;
  addPageChange(body: PageChange): Promise<void>;
  /** Oldest first, the ones after id `after` — the updater keeps its own cursor. */
  pageChanges(after: number, limit: number): Promise<Stored<PageChange>[]>;
  /** Newest first, the ones at or after `since` — how far the data is behind (`data-status.ts`). */
  pageChangesSince(since: Date, limit: number): Promise<Stored<PageChange>[]>;
  /** One day's daily puzzles, or null if nobody has asked for that day yet. */
  daily(day: string): Promise<DailySet | null>;
  /**
   * Keeps a day's puzzles unless the day already has some, and returns whichever
   * set is kept — the first one made always wins, so a day never changes.
   */
  addDaily(set: DailySet): Promise<DailySet>;
  /** The days from `since` on, oldest first — what a new day avoids repeating. */
  dailies(since: string): Promise<DailySet[]>;
  /** Replaces a day's puzzles — the schedule editor, for today and the days after it only. */
  setDaily(set: DailySet): Promise<void>;
  /** One platform's latest follower counts, or null. Only ever the latest: a new set replaces the old. */
  socials(platform: Platform): Promise<SocialCounts | null>;
  setSocials(platform: Platform, counts: SocialCounts): Promise<void>;
  /** The socials fetcher's own memory: YouTube's handle lookups, the Twitch login. Null deletes. */
  socialState(key: string): Promise<unknown>;
  setSocialState(key: string, value: unknown): Promise<void>;
}

export interface SocialCounts {
  fetched: string;
  counts: Record<string, number>;
}

/** The UTC hour a moment falls in, "YYYY-MM-DDTHH" — the funnel's key, and sortable as text. */
export const hourKey = (at: Date): string => at.toISOString().slice(0, 13);

export async function openStore(): Promise<Store> {
  const url = process.env.DATABASE_URL;
  if (url) return PostgresStore.open(url);
  const dir = process.env.DATA_DIR ?? path.join(process.cwd(), 'server', '.data');
  return FileStore.open(dir);
}

// ----------------------------------------------------------------- Postgres --

class PostgresStore implements Store {
  private constructor(private readonly pool: pg.Pool) {}

  static async open(url: string): Promise<PostgresStore> {
    // Heroku's Postgres needs TLS and presents a certificate Node will not
    // verify out of the box; a local database needs neither.
    const local = /localhost|127\.0\.0\.1/.test(url);
    const pool = new pg.Pool({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
    await pool.query(`
      create table if not exists rounds (
        id bigserial primary key,
        at timestamptz not null default now(),
        game text not null,
        body jsonb not null
      );
      create index if not exists rounds_at on rounds (at);
      create table if not exists support (
        id bigserial primary key,
        at timestamptz not null default now(),
        status text not null default 'new',
        body jsonb not null
      );
      create table if not exists client_errors (
        id bigserial primary key,
        at timestamptz not null default now(),
        body jsonb not null
      );
      create table if not exists liquipedia_changes (
        id bigserial primary key,
        at timestamptz not null default now(),
        body jsonb not null
      );
      create table if not exists daily_puzzles (
        day text primary key,
        at timestamptz not null default now(),
        body jsonb not null
      );
      create table if not exists social_counts (
        platform text primary key,
        body jsonb not null
      );
      create table if not exists social_state (
        key text primary key,
        body jsonb not null
      );
      create table if not exists funnel (
        hour text not null,
        page text not null,
        step text not null,
        mode text not null,
        n integer not null,
        primary key (hour, page, step, mode)
      );
    `);
    return new PostgresStore(pool);
  }

  async addRound(body: RoundRecord): Promise<void> {
    await this.pool.query('insert into rounds (game, body) values ($1, $2)', [body.game, body]);
  }

  async rounds(since?: Date): Promise<Stored<RoundRecord>[]> {
    const { rows } = await this.pool.query(
      'select id, at, body from rounds where at >= $1 order by id',
      [since ?? new Date(0)],
    );
    return rows.map((row) => ({ id: Number(row.id), at: new Date(row.at).toISOString(), body: row.body }));
  }

  async addFunnel({ hour, page, step, mode }: Omit<FunnelCount, 'n'>): Promise<void> {
    await this.pool.query(
      `insert into funnel (hour, page, step, mode, n) values ($1, $2, $3, $4, 1)
       on conflict (hour, page, step, mode) do update set n = funnel.n + 1`,
      [hour, page, step, mode],
    );
  }

  async funnel(since?: Date): Promise<FunnelCount[]> {
    const { rows } = await this.pool.query('select hour, page, step, mode, n from funnel where hour >= $1', [
      hourKey(since ?? new Date(0)),
    ]);
    return rows.map((row) => ({ ...row, n: Number(row.n) }));
  }

  async addSupport(body: SupportRequest): Promise<void> {
    await this.pool.query('insert into support (body) values ($1)', [body]);
  }

  async support(): Promise<StoredSupport[]> {
    const { rows } = await this.pool.query('select id, at, status, body from support order by id desc limit 500');
    return rows.map((row) => ({
      id: Number(row.id),
      at: new Date(row.at).toISOString(),
      status: row.status,
      body: row.body,
    }));
  }

  async setSupportStatus(id: number, status: SupportStatus): Promise<boolean> {
    const { rowCount } = await this.pool.query('update support set status = $1 where id = $2', [status, id]);
    return (rowCount ?? 0) > 0;
  }

  async addError(body: ClientError): Promise<void> {
    await this.pool.query('insert into client_errors (body) values ($1)', [body]);
  }

  async errors(limit: number): Promise<Stored<ClientError>[]> {
    const { rows } = await this.pool.query('select id, at, body from client_errors order by id desc limit $1', [limit]);
    return rows.map((row) => ({ id: Number(row.id), at: new Date(row.at).toISOString(), body: row.body }));
  }

  async addPageChange(body: PageChange): Promise<void> {
    await this.pool.query('insert into liquipedia_changes (body) values ($1)', [body]);
  }

  async pageChanges(after: number, limit: number): Promise<Stored<PageChange>[]> {
    const { rows } = await this.pool.query(
      'select id, at, body from liquipedia_changes where id > $1 order by id limit $2',
      [after, limit],
    );
    return rows.map((row) => ({ id: Number(row.id), at: new Date(row.at).toISOString(), body: row.body }));
  }

  async pageChangesSince(since: Date, limit: number): Promise<Stored<PageChange>[]> {
    const { rows } = await this.pool.query(
      'select id, at, body from liquipedia_changes where at >= $1 order by id desc limit $2',
      [since, limit],
    );
    return rows.map((row) => ({ id: Number(row.id), at: new Date(row.at).toISOString(), body: row.body }));
  }

  async daily(day: string): Promise<DailySet | null> {
    const { rows } = await this.pool.query('select body from daily_puzzles where day = $1', [day]);
    return rows[0]?.body ?? null;
  }

  async addDaily(set: DailySet): Promise<DailySet> {
    await this.pool.query('insert into daily_puzzles (day, body) values ($1, $2) on conflict (day) do nothing', [
      set.day,
      set,
    ]);
    return (await this.daily(set.day)) ?? set;
  }

  async dailies(since: string): Promise<DailySet[]> {
    const { rows } = await this.pool.query('select body from daily_puzzles where day >= $1 order by day', [since]);
    return rows.map((row) => row.body);
  }

  async setDaily(set: DailySet): Promise<void> {
    await this.pool.query(
      'insert into daily_puzzles (day, body) values ($1, $2) on conflict (day) do update set body = excluded.body',
      [set.day, set],
    );
  }

  async socials(platform: Platform): Promise<SocialCounts | null> {
    const { rows } = await this.pool.query('select body from social_counts where platform = $1', [platform]);
    return rows[0]?.body ?? null;
  }

  async setSocials(platform: Platform, counts: SocialCounts): Promise<void> {
    await this.pool.query(
      'insert into social_counts (platform, body) values ($1, $2) on conflict (platform) do update set body = excluded.body',
      [platform, counts],
    );
  }

  async socialState(key: string): Promise<unknown> {
    const { rows } = await this.pool.query('select body from social_state where key = $1', [key]);
    return rows[0]?.body ?? null;
  }

  async setSocialState(key: string, value: unknown): Promise<void> {
    if (value === null) {
      await this.pool.query('delete from social_state where key = $1', [key]);
      return;
    }
    await this.pool.query(
      'insert into social_state (key, body) values ($1, $2) on conflict (key) do update set body = excluded.body',
      [key, JSON.stringify(value)],
    );
  }
}

// -------------------------------------------------------------------- files --

/**
 * One JSON object per line, one file per table, held in memory as well.
 *
 * For running locally and for the server's own checks — not for Heroku, whose
 * disk is wiped on every restart. There, attach Postgres.
 */
class FileStore implements Store {
  private rows: Stored<RoundRecord>[] = [];
  private tickets: StoredSupport[] = [];
  private faults: Stored<ClientError>[] = [];
  private changes: Stored<PageChange>[] = [];
  private days = new Map<string, DailySet>();
  /** The funnel's counts by `hour|page|step|mode`. On disk, one line per increment. */
  private counts = new Map<string, FunnelCount>();

  private constructor(private readonly dir: string) {}

  static async open(dir: string): Promise<FileStore> {
    await mkdir(dir, { recursive: true });
    const store = new FileStore(dir);
    store.rows = await store.read('rounds');
    store.tickets = await store.read('support');
    store.faults = await store.read('errors');
    store.changes = await store.read('liquipedia');
    for (const set of await store.read<DailySet>('daily')) {
      if (!store.days.has(set.day)) store.days.set(set.day, set);
    }
    for (const key of await store.read<Omit<FunnelCount, 'n'>>('funnel')) store.count(key);
    return store;
  }

  private count(key: Omit<FunnelCount, 'n'>): void {
    const id = `${key.hour}|${key.page}|${key.step}|${key.mode}`;
    const row = this.counts.get(id) ?? { ...key, n: 0 };
    row.n++;
    this.counts.set(id, row);
  }

  private file(name: string): string {
    return path.join(this.dir, `${name}.jsonl`);
  }

  private async read<T>(name: string): Promise<T[]> {
    try {
      const text = await readFile(this.file(name), 'utf8');
      return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);
    } catch {
      return [];
    }
  }

  private async append(name: string, row: unknown): Promise<void> {
    await appendFile(this.file(name), `${JSON.stringify(row)}\n`);
  }

  private next(rows: { id: number }[]): number {
    return rows.length ? rows[rows.length - 1].id + 1 : 1;
  }

  async addRound(body: RoundRecord): Promise<void> {
    const row = { id: this.next(this.rows), at: new Date().toISOString(), body };
    this.rows.push(row);
    await this.append('rounds', row);
  }

  async rounds(since?: Date): Promise<Stored<RoundRecord>[]> {
    return since ? this.rows.filter((row) => new Date(row.at) >= since) : [...this.rows];
  }

  async addFunnel(key: Omit<FunnelCount, 'n'>): Promise<void> {
    this.count(key);
    await this.append('funnel', key);
  }

  async funnel(since?: Date): Promise<FunnelCount[]> {
    const from = hourKey(since ?? new Date(0));
    return [...this.counts.values()].filter((row) => row.hour >= from).map((row) => ({ ...row }));
  }

  async addSupport(body: SupportRequest): Promise<void> {
    const row: StoredSupport = { id: this.next(this.tickets), at: new Date().toISOString(), status: 'new', body };
    this.tickets.push(row);
    await this.append('support', row);
  }

  async support(): Promise<StoredSupport[]> {
    return [...this.tickets].reverse();
  }

  async setSupportStatus(id: number, status: SupportStatus): Promise<boolean> {
    const ticket = this.tickets.find((row) => row.id === id);
    if (!ticket) return false;
    ticket.status = status;
    await writeFile(this.file('support'), this.tickets.map((row) => `${JSON.stringify(row)}\n`).join(''));
    return true;
  }

  async addError(body: ClientError): Promise<void> {
    const row = { id: this.next(this.faults), at: new Date().toISOString(), body };
    this.faults.push(row);
    await this.append('errors', row);
  }

  async errors(limit: number): Promise<Stored<ClientError>[]> {
    return [...this.faults].reverse().slice(0, limit);
  }

  async addPageChange(body: PageChange): Promise<void> {
    const row = { id: this.next(this.changes), at: new Date().toISOString(), body };
    this.changes.push(row);
    await this.append('liquipedia', row);
  }

  async pageChanges(after: number, limit: number): Promise<Stored<PageChange>[]> {
    return this.changes.filter((row) => row.id > after).slice(0, limit);
  }

  async pageChangesSince(since: Date, limit: number): Promise<Stored<PageChange>[]> {
    const from = since.toISOString();
    return this.changes.filter((row) => row.at >= from).reverse().slice(0, limit);
  }

  async daily(day: string): Promise<DailySet | null> {
    return this.days.get(day) ?? null;
  }

  async addDaily(set: DailySet): Promise<DailySet> {
    const kept = this.days.get(set.day);
    if (kept) return kept;
    this.days.set(set.day, set);
    await this.append('daily', set);
    return set;
  }

  async dailies(since: string): Promise<DailySet[]> {
    return [...this.days.values()].filter((set) => set.day >= since).sort((a, b) => a.day.localeCompare(b.day));
  }

  async setDaily(set: DailySet): Promise<void> {
    this.days.set(set.day, set);
    const all = [...this.days.values()].sort((a, b) => a.day.localeCompare(b.day));
    await writeFile(this.file('daily'), all.map((row) => `${JSON.stringify(row)}
`).join(''));
  }

  // The follower counts and their state are one small JSON file each, rewritten
  // whole: only the latest is ever kept.
  private async readOne<T>(name: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, `${name}.json`), 'utf8')) as T;
    } catch {
      return null;
    }
  }

  private async writeOne(name: string, value: unknown): Promise<void> {
    await writeFile(path.join(this.dir, `${name}.json`), JSON.stringify(value));
  }

  async socials(platform: Platform): Promise<SocialCounts | null> {
    return this.readOne<SocialCounts>(`socials-${platform}`);
  }

  async setSocials(platform: Platform, counts: SocialCounts): Promise<void> {
    await this.writeOne(`socials-${platform}`, counts);
  }

  async socialState(key: string): Promise<unknown> {
    return (await this.readOne<Record<string, unknown>>('socials-state'))?.[key] ?? null;
  }

  async setSocialState(key: string, value: unknown): Promise<void> {
    const all = (await this.readOne<Record<string, unknown>>('socials-state')) ?? {};
    if (value === null) delete all[key];
    else all[key] = value;
    await this.writeOne('socials-state', all);
  }
}
