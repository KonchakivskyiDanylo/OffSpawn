import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GOOGLE_PRIVACY, YOUTUBE_TERMS } from '@/components/SocialsNote';
import { PRIVACY_META, usePageMeta } from '@/lib/seo';

/**
 * What the site keeps, and about whom.
 *
 * A short version first, then the detail, in plain words. It matches what the
 * code does — `analytics/types.ts` for a round, `server/index.ts` for what the
 * server keeps — and carries what YouTube's API terms ask of a site that shows
 * its data: that the site uses YouTube API Services, a link to YouTube's Terms
 * of Service and to Google's Privacy Policy, what is collected and stored, and
 * how to get in touch. Twitch's developer terms ask for a public privacy notice
 * too.
 */

const Ext = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="link" href={href} target="_blank" rel="noreferrer noopener">
    {children}
  </a>
);

export function Privacy() {
  usePageMeta(PRIVACY_META);
  return (
    <div className="page page--narrow stack-lg">
      <div className="stack-sm">
        <Link to="/" className="small muted" style={{ width: 'fit-content' }}>
          ← All games
        </Link>
        <h1>Privacy</h1>
      </div>

      <section className="card stack-sm">
        <div className="card__title">The short version</div>
        <ul className="small stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
          <li>No accounts, no ads, no tracking cookies, nothing loaded from other sites.</li>
          <li>Your results and streaks stay in your browser.</li>
          <li>The site counts which games are opened, started and finished, and how rounds went — without knowing who you are.</li>
        </ul>
      </section>

      <section className="card stack-sm">
        <div className="card__title">Kept in your browser</div>
        <p className="small">
          Your daily results, streaks, best scores and settings are saved in your browser’s local storage, on
          your device only. They are never sent anywhere. Clearing your browser’s data for this site deletes
          them, and they do not follow you to another browser or device.
        </p>
      </section>

      <section className="card stack-sm">
        <div className="card__title">What the site records</div>
        <p className="small">
          When you finish a round, the site sends a short record of it: the game, the puzzle, how you set it up,
          your answers and whether you won. It is used to see which puzzles are too hard or too easy. Nothing in
          it says who you are: there is no account, no device id and no cookie, and IP addresses are not saved.
        </p>
        <p className="small">
          It also counts when a page is opened and when a round is started, to see which games people open and
          how many go on to play. These are kept only as totals per hour — “Tenite was opened 40 times between
          six and seven” — never as a record of a visit, and nothing is stored in your browser for them.
        </p>
        <p className="small">
          If a page breaks, the site may send the error message and the page it happened on, so it can be
          fixed. It holds nothing about you either.
        </p>
      </section>

      <section className="card stack-sm">
        <div className="card__title">Messages you send</div>
        <p className="small">
          A message sent with the 💬 button is kept with whatever you write in it, the page you were on, and —
          only if you add them — your contact details and the round you just played. They are used only to
          answer you and to fix what you report.
        </p>
      </section>

      <section className="card stack-sm">
        <div className="card__title">YouTube and Twitch</div>
        <p className="small">
          Some games show players’ YouTube subscriber and Twitch follower counts. OffSpawn gets them from the
          YouTube Data API (YouTube API Services) and the Twitch API: only the public totals of the channels
          linked from players’ Liquipedia pages. The site asks YouTube and Twitch for nothing about you. It
          keeps only the latest counts, refreshed every day, and never longer than YouTube and Twitch allow.
        </p>
        <p className="small">
          By using the parts of OffSpawn that show these counts, you agree to be bound by the{' '}
          <Ext href={YOUTUBE_TERMS}>YouTube Terms of Service</Ext>. Google’s handling of YouTube data is
          described in the <Ext href={GOOGLE_PRIVACY}>Google Privacy Policy</Ext>.
        </p>
      </section>

      <section className="card stack-sm">
        <div className="card__title">Questions</div>
        <p className="small muted" style={{ margin: 0 }}>
          Ask with the 💬 button at the top of any page. Where the data comes from is on{' '}
          <Link to="/credits" className="link">
            Credits &amp; licence
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
