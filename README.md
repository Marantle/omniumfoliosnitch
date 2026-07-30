# omniumfoliosnitch

Tracks which Finnish mythic raiders have been slacking on their Omnium Folio
weeklies, published nightly to GitHub Pages. Also a small CLI for pulling
character profile data from the Blizzard WoW API (EU region).
Runs on [Bun](https://bun.sh), written in TypeScript.

## Setup

1. Create an API client at https://develop.battle.net/access/clients
2. Copy `.env.example` to `.env` and fill in the client id and secret
3. `bun install`

## Character lookup

```
bun src/index.ts <realm-slug> <character-name> [subresource]
```

Examples:

```
bun src/index.ts draenor thrall
bun src/index.ts draenor thrall equipment
bun src/index.ts tarren-mill somechar mythic-keystone-profile
```

With no subresource you get the base character profile. Run without arguments
to see the list of known subresources (equipment, media, achievements, etc).

Realm slug is the lowercase dashed form of the realm name, e.g. Tarren Mill
becomes `tarren-mill`.

## Omnium Folio report

Checks every guild member at a given rank or above for Omnium Folio progress
(the 12.0.7 five-week unlock, tracked through the Omnium Folio Studies
achievement).

```
bun src/omnium.ts <realm-slug> <guild-slug> <rank-number-or-character> [--html] [--lura]
```

Passing a character name uses that character's rank as the cutoff. With
`--html` the members who are not done are also written to a timestamped
`report-YYYY-MM-DD-HHMM.html`, rendered from `templates/report.ejs`. With
`--lura` only members who have the Mythic: Midnight Falls achievement (the
mythic L'ura kill) are counted, which narrows the list to the mythic raiders.

Note the folio is per character, so an alt showing as behind can still belong
to someone whose main is finished.

## Finding the mythic raiders

```
bun src/raiders.ts [--only <guild-name-part>]
```

Crawls Warcraft Logs for every guild in `tracked-guilds.json` and writes
`raiders.json`: the characters who repeatedly appear in the guild's mythic
reports for the current raid tier. Needs `WCL_CLIENT_ID` and
`WCL_CLIENT_SECRET` in `.env`, from a client made at
https://www.warcraftlogs.com/api/clients.

Report fight data is cached in `cache/`, old reports never change so only
new reports cost API points on later runs. The first full crawl is slow and
can hit the hourly points budget, the script waits it out and continues.

## Nightly snapshots and GitHub Pages

```
bun src/site.ts [--lura]
```

Checks folio progress for every raider in `raiders.json`, saves the day's
results to `data/<date>.json` and rebuilds the pages in `site/`, one per
stored day with links between days, `index.html` being the newest. Each
guild is an expandable section showing who is behind, guilds with everyone
done show a green all done badge. Guilds where nobody has a mythic L'ura
kill are left out of the day.

Two workflows keep it running: `raiders.yml` recrawls Warcraft Logs on
Monday mornings (the report cache keeps recrawls cheap), `nightly.yml` runs
the folio check every night, commits the new snapshot and deploys `site/`
to GitHub Pages.

To set it up on GitHub:

1. Push the repo
2. Add `BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`, `WCL_CLIENT_ID` and
   `WCL_CLIENT_SECRET` as repository secrets
   (Settings > Secrets and variables > Actions)
3. Set Pages source to GitHub Actions (Settings > Pages)

You can also trigger a run by hand from the Actions tab.
