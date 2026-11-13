# ICPC Practice

A local training workbench for ICPC, built around the three judges most used in Canada: **Codeforces**, **LeetCode** and **Kattis**.
It pulls your submissions into a database on your own computer and turns them into a dashboard, daily problem picks, a
spaced-repetition review queue, a training calendar and a contest list, all shown in your Canadian time zone.

Inspired by [ZF3373/icpc-workbench](https://github.com/ZF3373/icpc-workbench), which targets Chinese judges. This is a separate,
smaller implementation written from scratch, with no AI features.

## Quick start

Requires **Node.js 22.5 or newer** (it uses the built-in `node:sqlite`, so nothing needs compiling).

```bash
npm install
npm start          # builds the UI, then serves everything at http://127.0.0.1:3001
```

For development with hot reload (UI on http://localhost:5173, API on 3001):

```bash
npm run dev
```

Then open **Accounts & settings**, link your handles, and press **Sync all** on the dashboard. On **Problems → Problem bank**,
fetch the three problem sets once so the daily picks have something to choose from.

## What it does

| Page | What you get |
| --- | --- |
| **Dashboard** | Solved totals, weekly count, practice streak, acceptance rate; a card per judge (CF rating and history, LeetCode easy/medium/hard and contest rating, Kattis score, rank and province); a one-year activity heatmap; solved-by-difficulty bars; a 12-week trend; weak topics and ICPC topics you have never touched. |
| **Today** | Unsolved problems near your level, one per weak topic plus a Kattis problem and a stretch problem. Picks stay fixed for the day until you ask for new ones. Also lists problems you tried and never got accepted, today’s plan and reviews that are due. |
| **Problems** | Everything you have attempted, plus the full Codeforces, LeetCode and Kattis problem sets. Filter by judge, status, topic and difficulty. Mark problems solved by hand or queue them for review. |
| **Contests** | Upcoming Codeforces, LeetCode and Kattis contests in your time zone, with countdowns and `.ics` export (with a 30-minute reminder). Add your own events: your ICPC regional, NAC, a university qualifier, team practice. |
| **Calendar** | Plan tasks per day (free text or pasted problem links), tick them off, see due reviews and contests, keep a streak of fully-done days. |
| **Reviews** | Re-solve problems on a 1 → 3 → 7 → 14 → 30 → 60 → 120 → 240-day ladder. Grade each attempt *Forgot / Hard / Good / Easy*, and keep a one-line note of the key idea. |
| **Problem lists** | Paste a set of links (a topic week, a past regional) and track it until it’s all solved. |
| **Accounts & settings** | Link accounts, choose your time zone (Pacific through Newfoundland), set your university or regional, back up and restore. |

### One difficulty scale

So the three judges can be compared, every problem is mapped onto the Codeforces rating scale (800–3500):

- **Codeforces**: the problem rating as is.
- **LeetCode**: Easy ≈ 1100, Medium ≈ 1600, Hard ≈ 2100.
- **Kattis**: 1.0–10.0 mapped linearly, `800 + (d − 1) × 300` (so 3.0 ≈ 1400, 5.0 ≈ 2000).

These are rough (±200) and only meant for bucketing and recommendations. The original label is always shown next to a problem.

Topic tags are folded into one vocabulary (“dp” and “Dynamic Programming” are the same topic). Kattis publishes no tags, so Kattis
problems count toward difficulty and activity but not toward topic analysis.

## Linking each judge

**Codeforces**: just your handle. Full submission history, rating and contest history come from the public API.

**LeetCode**: your username alone gives your profile stats and your **20 most recent accepted** submissions (LeetCode’s public limit).
Syncing regularly builds up history over time. For your complete history, add your session cookie:
log in at leetcode.com → developer tools → Application → Cookies → copy `LEETCODE_SESSION` and `csrftoken`.
With the cookie saved, fetching the LeetCode problem bank also marks every problem LeetCode reports as solved.
The cookie expires after a few weeks; sync will tell you when to replace it.

**Kattis**: your username (as in `open.kattis.com/users/<name>`) gives score, rank, country and province.
Kattis has no public list of a user’s solved problems. You have two options:

1. Add the **token** from your `.kattisrc` file (download it from <https://open.kattis.com/download/kattisrc>, the same file the
   Kattis submit tool uses). The app logs in the way the CLI does and reads the problem list as you (about 70 pages, a couple of minutes).
   The first scan has no solve dates; problems newly solved after that are dated to the sync that found them.
2. **Paste solved problems**: on the Kattis account card, paste problem ids or links, one per line.

## Privacy

- The server listens on `127.0.0.1` only.
- Everything is stored in `data/workbench.db` in this folder.
- Cookies and tokens are kept in that local database, never sent back to the browser and never included in backups.
- The only outside sites contacted are codeforces.com, leetcode.com and open.kattis.com, with one request at a time per site
  and a pause between requests.

## Project layout

```
server/  Express + node:sqlite API (TypeScript, run with tsx)
  src/adapters/   codeforces.ts, leetcode.ts, kattis.ts
  src/stats.ts    dashboard aggregates, level estimate, weak-topic scoring
  src/recommend.ts  daily picks
client/  React + Vite UI, no UI framework; charts are hand-drawn SVG
data/    your database (git-ignored)
```

Environment variables: `PORT` (default 3001), `HOST` (default 127.0.0.1), `DATA_DIR` (default `./data`).

## Known limitations

- The Kattis token sign-in follows the official CLI’s login, but how solved problems are marked on the logged-in problem list
  could not be checked without a real account. If a token sync reports “no solved markers were found”, use **Paste solved problems**
  (and please fix the matcher in `server/src/adapters/kattis.ts → parseProblemRows`).
- LeetCode without a cookie only sees recent accepted submissions, so its acceptance rate and failed attempts are incomplete.
- Kattis and LeetCode pages are unofficial interfaces and may change.
