# FF16 Scoreboard

Online scoring for Cape Cod Frosty Fleet #16: a public leaderboard plus Race Committee (RC) tools for racers, race days and race results. It runs on Cloudflare's free plan (Proposal B in [proposals.html](proposals.html)).

- **Public:** `/` standings · `/schedule` · `/day/<id>` race-day results · `/api/standings` JSON (for embedding on the WordPress site)
- **Race Committee:** `/admin` (protected by Cloudflare Access with an emailed one-time code)

## Scoring rules

Implemented in [`src/scoring.ts`](src/scoring.ts) and tested in [`src/scoring.test.ts`](src/scoring.test.ts):

- Race score = **finishers in that race + finishers behind you** (NoR §9).
- **DNF / DSQ / OCS / RET** score 0 and **don't count** toward the number of boats in the race (RC ruling, Nov 2026).
- **DNR** (no result entered for a racer) scores 0.
- Each racer drops their lowest **floor(20% × races held)** scores. "Races held" counts races actually sailed and scored, not races scheduled. So after 5 races, everyone drops 1, and after 10 races, everyone drops 2.
- Equal totals share a rank. There is no tie-break.
- The admin page flags racers with 3+ races for the $25 season fee (NoR §5).

## How it fits together

```
Public ──► Cloudflare Worker (src/index.ts) ──► D1 database (SQLite)
RC ──► Cloudflare Access (email code) ──► /admin on the same Worker
GitHub push to main ──► GitHub Actions: test → apply DB migrations → deploy
```

| Path | What |
|---|---|
| `src/scoring.ts` | Pure scoring logic (no database), unit-tested |
| `src/validate.ts` | Checks a results form before saving (places 1..N, no gaps or duplicates) |
| `src/db.ts` | All database queries |
| `src/auth.ts` | Verifies the Cloudflare Access login on every `/admin` request (refuses access if not configured) |
| `src/views/` | HTML pages (public and admin) |
| `public/` | Static files: stylesheet and logo |
| `migrations/` | Database schema and the 2026–27 schedule from the NoR, applied automatically on deploy |
| `../../.github/workflows/scoreboard.yml` | CI: tests on every PR, deploys on merge to `main` |

## Run it locally

```sh
cd tech/scoreboard
npm install
cp .dev.vars.example .dev.vars     # lets /admin work on localhost without Access
npm run db:migrate:local           # creates a local database with the 2026–27 schedule
npm run dev                        # http://localhost:8787  (admin: http://localhost:8787/admin)
npm test                           # scoring tests
```

The local database lives in `.wrangler/` and is separate from the live one.

---

## First-time setup (one time, about 30 minutes)

### 1. Create a Cloudflare account
Sign up for free at <https://dash.cloudflare.com/sign-up>.

### 2. Create the database
```sh
cd tech/scoreboard
npx wrangler login                          # opens a browser to authorize
npx wrangler d1 create ff16-scoreboard
```
Copy the `database_id` it prints into the existing `DB` entry in `wrangler.jsonc`. If wrangler offers to add the database to your config for you, answer **No**. Otherwise it adds a second, unused entry. (Already done for FF16: the id is `1efb45c7-…`.)

### 3. First deploy
```sh
npm run db:migrate:remote      # creates tables + the 2026–27 schedule in the live database
npx wrangler deploy
```
On the first deploy, Cloudflare asks you to pick a `workers.dev` subdomain. The site is then live at `https://ff16-scoreboard.<your-subdomain>.workers.dev` (FF16: <https://ff16-scoreboard.joshabell.workers.dev>). The leaderboard works right away. `/admin` says "Race Committee only" until step 4 is done, which is expected.

### 4. Protect `/admin` with Cloudflare Access
Cloudflare now calls Zero Trust **Cloudflare One**. FF16's team domain is `frosty-bird-3d44.cloudflareaccess.com`, and it's already in `wrangler.jsonc`.

1. **Turn on email codes:** Cloudflare One → **Integrations → Identity providers → Add new identity provider → One-time PIN**. New accounts don't have it by default.
2. **Create the Race Committee list:** Cloudflare One → **Access controls → Policies → Create new policy**.
   - Policy name: `Race Committee` · Action: **Allow** · Session duration: e.g. 1 week
   - Add a rule: **Include** → selector **Emails** → `joshabell@gmail.com`
   - Save. *This policy is the RC list. Adding or removing a member means editing its emails.*
3. **Protect `/admin`:** **Access controls → Applications → Create new application → Self-hosted and private**.
   - Name: `FF16 Race Committee`
   - **Add public hostname**: subdomain `ff16-scoreboard`, domain `joshabell.workers.dev`, path `admin`
   - **Add public hostname** again with path `admin/*`
   - Access policies: select **Race Committee**
   - If the form shows an identity-provider / login-methods section, leave all providers accepted (or tick **One-time PIN**). If it doesn't show one, skip it.
   - **Create**
   - If `joshabell.workers.dev` isn't offered in the domain dropdown, stop here. That needs a different setup (see "Using a subdomain" below, or ask).
4. Open the new application and copy its **Application Audience (AUD) Tag**.
5. Put it in `wrangler.jsonc` as `"ACCESS_AUD": "<the AUD tag>"` and run `npx wrangler deploy`.

Visit `/admin`. Cloudflare asks for your email, sends a code, and then shows the RC pages.

### 5. Turn on automatic deploys from GitHub
1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** → use the **Edit Cloudflare Workers** template, and also add **Account → D1 → Edit**. Copy the token.
2. Find your **Account ID** on the Workers & Pages overview page (right-hand side).
3. GitHub repo → **Settings → Secrets and variables → Actions**:
   - *Secrets* tab: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   - *Variables* tab: add `SCOREBOARD_DEPLOY` = `true`
4. Recommended: **Settings → Branches → Add rule** for `main` → *Require status checks to pass* → select `test`. A change that breaks scoring then can't be merged.

From then on, every merge to `main` that touches `tech/scoreboard/` runs the tests, applies any new database migrations, and deploys. Watch it under the repo's **Actions** tab.

---

## Everyday tasks

**Add or remove a Race Committee member:** Cloudflare One → Access controls → Policies → `Race Committee` → add or remove their email → Save. Nothing else is needed.

**On race day (RC):** open `/admin` → *Manage this race day* → add any new racers → *Enter race 1*. Tap racers in finishing order, pick DNF/DSQ/OCS/RET from the dropdown where needed, and save. The leaderboard updates immediately. Mistakes can be fixed with *Edit* or *Delete*. Every change is recorded in the *Change log*.

**Cancel a day or use a backup date:** open the race day → *Race day details* → change the status (Scheduled / BYE / Cancelled), venue or start time.

**Backups:** D1 keeps 7 days of point-in-time history on the free plan (`npx wrangler d1 time-travel restore`). For a full copy: `npx wrangler d1 export ff16-scoreboard --remote --output backup.sql`.

## Using a subdomain of the FF16 website later

Cloudflare can only attach a Worker to a domain whose DNS it manages. So `scores.<ff16-domain>` means moving the FF16 domain's nameservers to Cloudflare. That's free, but it touches the WordPress site's DNS and any email records, so it deserves a careful hour:

1. Cloudflare dashboard → **Add a domain**. It scans and imports the existing DNS records. Check that they match your current provider's records, especially the website and any `MX` (email) records.
2. Change the nameservers at your domain registrar to the two Cloudflare gives you, then wait for the domain to become active.
3. Worker → **Settings → Domains & Routes → Add → Custom domain** → `scores.<ff16-domain>`.
4. Add the new hostname (paths `admin` and `admin/*`) to the Access application.

No code changes are needed. Until then, the `workers.dev` address works fine and can be linked from the WordPress site.
