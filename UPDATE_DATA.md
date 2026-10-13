# Updating the data

Do this once a week, or the day after a big event. It takes about five to ten
minutes, and you can run it any time — a longer gap just means a few more
requests.

Everything below runs in a terminal (PowerShell) in the OffSpawn folder.

---

## First time only

These are once per computer. A fresh `git clone` has none of them: no Python
packages, no keys and no raw dump.

### Python

The data scripts run in their own Python environment, `.venv` in this folder
(git ignores it). Python 3.12 or newer:

```powershell
py -m venv .venv
```

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
```

Every `.venv\Scripts\python` command below needs this. Without it you get
`ModuleNotFoundError: No module named 'pandas'` or `requests`, or PowerShell
says `.venv\Scripts\python` is not recognised. `requirements.txt` keeps pandas
below 3: the cleaning step was written for pandas 2.

### The raw dump

Step 1 below only fetches what changed since the last run, and it keeps
everything it fetched in `liquipedia_data/raw_data/fortnite/`. That folder is
not in git (it is over 500 MB), so on a new computer it is empty, and the first
run reads every table whole: about 470 requests, **roughly eight hours** at
the key's 60 an hour. Two ways:

- **Copy it** from the computer that last updated the data: the whole
  `liquipedia_data\raw_data` folder, into the same place here. Step 1 then
  carries on from that computer's last run and takes the usual few minutes.
- **Or let it run**, in the evening. It waits for the limit by itself, and
  Ctrl+C is safe: run the same command again and it carries on.

### Keys

`setx` keeps a setting for good, so **open a new terminal after the last one**
— the terminal you ran it in does not see it yet. Never put a key in a file in
this repo, or in a commit.

#### Liquipedia

Your Liquipedia API key and a way to contact you:

```powershell
setx LIQUIPEDIA_API_KEY "paste-your-key-here"
```

```powershell
setx LIQUIPEDIA_USER_AGENT "OffSpawn/1.0 (your-email@example.com)"
```

#### YouTube (for subscriber counts)

1. Open https://console.cloud.google.com and sign in with a Google account.
2. Create a project (top bar → the project picker → **New project**, any name).
3. **APIs & Services → Library**, search **YouTube Data API v3**, open it, **Enable**.
4. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
   Under **Edit API key → API restrictions**, restrict it to YouTube Data API v3.
5. Save it:

```powershell
setx YOUTUBE_API_KEY "paste-the-key-here"
```

It is free: 10,000 units a day. The first run spends about 1,500–1,900, every
run after it about 70.

#### Twitch (for follower counts)

1. Turn on two-factor authentication on your Twitch account (Twitch asks for it
   before you can register an app).
2. Open https://dev.twitch.tv/console → **Register Your Application**:
   - Name: anything, e.g. `OffSpawn stats`
   - OAuth Redirect URLs: `https://localhost` (required and must be https, but never used — the login is a code you type in)
   - Category: **Analytics Tool**
   - Client Type: **Public**
3. **Create**, then **Manage** on the new app. Copy the **Client ID** and save it:

```powershell
setx TWITCH_CLIENT_ID "paste-the-client-id-here"
```

The first time the counts run, it asks you to log in once (see step 2 below).

---

## Every update

### 1. Get what changed on Liquipedia

```powershell
.venv\Scripts\python scripts\liquipedia_api.py
```

About 2–5 minutes, around 20 of the key's 60 requests an hour. It prints one
line per table, for example:

```
player: 5,737 -> 5,741 rows (0 removed)
placement: 443,400 -> 445,012 rows (12 removed)
done - 19 requests this run
```

### 2. YouTube subscribers and Twitch followers

```powershell
.venv\Scripts\python scripts\socials_api.py
```

It reads the YouTube and Twitch links on every player's Liquipedia page (from
step 1) and asks each platform for the numbers. About five minutes, most of it
Twitch. It prints, for example:

```
youtube: 3,396 players link 3,395 channels
youtube: 2,950 players with a count, 310 links found no channel, 71 units
twitch: 3,585 players link 3,580 channels
twitch: 3,402 players with a count, 178 logins not found
```

**The first time only**, Twitch asks you to log in:

```
twitch: log in - open https://www.twitch.tv/activate and enter the code ABCD-EFGH
```

Open that page, enter the code, click **Authorize**. The script carries on by
itself. After that it stays logged in (the login is kept in
`C:\Users\<you>\.offspawn\twitch_token.json`, outside the repo) — unless you
skip it for more than 30 days, when it simply asks again.

The numbers go to `liquipedia_data/clean_data/fortnite/socials.json`, which
stays on your machine (it is never committed). **This step is optional:** the
live site fetches its own counts every day (see "The follower counts on the
live site" below). Your local copy is what a dev server and `check:games` use.

Only one platform: `socials_api.py youtube` or `socials_api.py twitch`. A
player with two channels on one platform gets the bigger one; a channel that
hides its count is left out.

### 3. Build the site's data

```powershell
.venv\Scripts\python scripts\build_data.py
```

About a minute and a half. It cleans the raw data, adds FNCS titles and tiers,
builds the organisations, the bios (real names and organisation history), the
rankings, pools and the rest, runs every game's checks on the result, and only
then replaces the files. It ends with a before/after table and `Done`.

### 4. Look at the site (optional)

```powershell
npm run dev
```

Every game's "How to play" shows the new date as *last update*.

### 5. Commit and push

```powershell
git add -A
```

```powershell
git commit -m "Data update"
```

```powershell
git push
```

Only the files the site reads are committed (`roster.json`, `players.json`,
`career_path.json`, `teammates.json`, `orgs.json`, `facts.json`,
`rankings.json`, `pools.json`, `bios.json`, `links.json`) plus the date in `src/data/liquipedia/roster.ts`.
The raw dump, the large in-between files and `socials.json` stay on your
machine — `.gitignore` handles that.

---

## The follower counts on the live site

YouTube lets a subscriber count be kept 30 days and Twitch 24 hours, so the
counts can never be a file in git. The live server fetches them itself about
once a day, keeps only the newest set, and stops showing a platform whose
counts got too old. It reads the channel links from `links.json`, which
`build_data.py` writes and you commit.

**Once, on Heroku** (Settings → Config Vars), add the same keys you use locally:

| Key | Value |
| --- | --- |
| `YOUTUBE_API_KEY` | your Google Cloud API key |
| `TWITCH_CLIENT_ID` | your Twitch application's client ID |
| `TWITCH_CLIENT_SECRET` | only if that application is Confidential |

Then open `/analytics/socials` on the live site, click **Log in to Twitch**,
open the link it shows and enter the code. YouTube needs no login. The page
shows when each platform was last fetched and has a **Fetch now** button.

Twitch only stays logged in while the server keeps using it (daily); if the
page ever says "Not on the site" for Twitch, log in again there.

## If something goes wrong

| You see | It means | Do |
| --- | --- | --- |
| `.venv\Scripts\python` is not recognised, or `No module named 'pandas'` / `'requests'` | this computer has no `.venv` yet | do "First time only" → "Python" |
| `No raw dump in … raw_data\fortnite - run scripts/liquipedia_api.py first` (step 3) | step 1 has never run on this computer | do "First time only" → "The raw dump" |
| step 1 runs for hours, and its tables end `player: 0 -> 5,741 rows` and so on | there was no raw dump here, so it read everything | expected once on a new computer; see "The raw dump" |
| `60 requests in the last hour - waiting …` | the key's hourly limit | nothing, leave it running |
| `rate limited (429) - waiting …` | Liquipedia asked it to wait | nothing, leave it running |
| you pressed Ctrl+C | — | run the same command again; it carries on where it stopped |
| `Set LIQUIPEDIA_API_KEY first` | the key is not set in this terminal | do "First time only", then open a new terminal |
| `youtube: YOUTUBE_API_KEY is not set - skipped` (or `TWITCH_CLIENT_ID`) | that platform's key is not set in this terminal | do "First time only" for it, then open a new terminal |
| `YouTube's daily quota is used up` | 10,000 units spent today | run step 2 again tomorrow; it keeps what it found and carries on |
| `YouTube … HTTP 403 … API key not valid` / `has not been used in project` | the key is wrong, or the YouTube API is not enabled for its project | redo "YouTube" steps 3–4 |
| `twitch: … the code expired before it was entered` | the login code was not entered within 30 minutes | run step 2 again and enter the new code |
| `Twitch login: HTTP 400 …` | the Client ID is wrong, or the app is not **Public** | check the app at dev.twitch.tv/console |
| `… - not overwriting` | Liquipedia, YouTube or Twitch sent back far fewer rows than we hold | nothing was changed; try again later, and if it repeats send the output |
| `The game checks failed, so nothing was replaced` | the new data breaks a game check | the site's data is unchanged; send the output |

---

## Every few months (optional)

A normal update re-reads players and teams whole, and tournaments, transfers
and placements from 30 days before the last update. A correction Liquipedia
makes to something older is only picked up by reading it all again:

```powershell
.venv\Scripts\python scripts\liquipedia_api.py --full tournament transfer placement
```

Tournaments and transfers take about an hour of the key's allowance;
placements about eight hours, so start it in the evening. It waits for the
limit by itself. Then do steps 2–5.

A YouTube or Twitch link that found nothing is asked about again after 30
days. To ask now — say a player fixed their link on Liquipedia:

```powershell
.venv\Scripts\python scripts\socials_api.py --recheck
```

`--search 40` also lets YouTube search by name for up to 40 links nothing else
finds (100 units each). A search returns the closest channel, which is not
always the right one, so it is off unless you ask.

---

## Once the site is hosted: webhooks (optional)

Liquipedia can tell the site whenever a Fortnite page changes, so those older
corrections arrive without the full re-read.

1. Pick a long random secret and give it to Heroku:
   ```powershell
   heroku config:set LIQUIPEDIA_WEBHOOK_SECRET=a-long-random-string
   ```
2. On your Liquipedia API account, set the webhook URL to
   `https://<your-app>.herokuapp.com/api/liquipedia/a-long-random-string`
3. Tell the update where the site is (once, then open a new terminal):
   ```powershell
   setx OFFSPAWN_URL "https://<your-app>.herokuapp.com"
   ```
   ```powershell
   setx OFFSPAWN_ADMIN_PASSWORD "your-dashboard-password"
   ```

Step 1 of every update then also re-reads the pages Liquipedia said changed.

---

## Changing how the data is built

The build is `scripts/build_data.py`, and each step is a file in
`scripts/pipeline/`: `clean.py` (raw -> clean tables), `enrich.py` (FNCS
titles, tiers, organisations, bios), `derived.py` (rankings, pools, teammates,
career path, facts). [DATA.md](DATA.md) explains what each file holds and why.

After changing one, you do not need Liquipedia again:

```powershell
.venv\Scripts\python scripts\build_data.py --from derived
```

`--from players` redoes titles, tiers, organisations and bios too; `--out
somewhere` builds into another folder so you can compare before touching the
real files.

**A new season.** Tenite's average-finish boards find each year's events on
their own: the rounds of FNCS grand finals by date, and Epic's LANs. List's
"played all 5 big events of 2026" still reads the events named in `SEASON_YEAR`
and `SEASON_EVENTS` in `derived.py`. Change those when the year's big events
change, then run `--from derived`.

**Testing the scripts.** `scripts/check_liquipedia_api.py` and
`scripts/check_socials_api.py` run the two download scripts against fake
APIs — no keys, no network, nothing written to your data. GitHub runs both on
every push.

---

The data is from [Liquipedia](https://liquipedia.net/fortnite) (CC-BY-SA 3.0),
FNCS titles included. The committed files are shared
under the same licence — see [CREDITS.md](CREDITS.md). Subscriber and follower
counts come from the YouTube Data API and the Twitch API, under their terms.
