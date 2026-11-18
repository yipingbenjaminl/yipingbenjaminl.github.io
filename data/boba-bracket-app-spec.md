# Boba Bracket App Spec

Updated November 18, 2026 · Organizers only

## Overview

A phone-first web app that runs a blind bubble tea taste-off for 21 tasters: it assigns panels, hands out cup letters, collects rankings and notes, scores every round automatically, and drives the reveal on a TV.

**The event it runs** (see the [Round 1 plan](boba-bracket-round-1.html) for the shop list and logistics):

- 12 shops in 4 hidden groups of 3.
- 21 tasters in 4 panels (Red 5, Blue 5, Green 5, Yellow 6).
- Round 1 and Round 2 each run two groups at once at two tables; every group is judged by two neighbouring panels (10–11 votes).
- The 4 group winners go to a final where all 21 rank them.
- Every taster ranks cups by "Which would you order again?" and can add notes.

**Goals**

- Nobody, including helpers who also taste, can link a cup letter to a shop until the reveal.
- Zero manual tallying: rankings turn into winners the moment a round closes.
- Works on any phone with a QR scan, no install or account.
- Keeps every ranking and note for a post-event look at the data.

**Non-goals**

- Ordering or paying for drinks, driver routing, or ticketing.
- Multi-event history or user accounts beyond a name per event.
- Native mobile apps.

## Users and roles

Every helper is also a taster, so each role sees exactly one slice of the secret and never the whole mapping.

| Role | Who | Sees | Never sees |
| --- | --- | --- | --- |
| Host | Benjamin (one device) | Setup, round status, vote counts, results after close | Nothing hidden; the host should not taste, or should set up and then hand host controls to the reveal screen |
| Bagger | 1 taster | Shop → secret number (1–12), pour counts per number | Cup letters |
| Labeller | 2 tasters, one per table | Secret number → cup letter for the current round at their table | Shop names |
| Taster | All 21 | Their panel colour, their current round's letters and placemat order, their own submitted ranking | Shops, groups, other tasters' votes, results |
| Reveal screen | TV or laptop | Results only when the host triggers each reveal step | Anything before the reveal |

**Host-as-taster option:** if Benjamin wants to taste, the host role splits too. Setup happens before shop numbers are assigned, and results stay sealed until the reveal, so the host screen during tasting shows only vote counts, never rankings or shop names.

## Event model

An event is 12 shops in 4 groups, 4 panels in a ring, and 3 rounds; the app must allow these numbers to change, but ships with this configuration.

**Groups (hidden)**

| Group | Shops |
| --- | --- |
| 1 | Bubble World, Pearl Fever, Happy Lemon |
| 2 | 101 Boba, CoCo, CHICHA San Chen |
| 3 | Chatime, Shiny Tea, Gong Cha |
| 4 | ChunFunHow, MACU Tea, SunTea |

**Panels and the ring schedule.** Each panel judges two neighbouring groups; each group gets two panels.

| Round | Table 1 | Table 2 |
| --- | --- | --- |
| 1 | Group 1: Red + Blue (10) | Group 3: Green + Yellow (11) |
| 2 | Group 2: Blue + Green (10) | Group 4: Yellow + Red (11) |
| Final | 4 group winners: all 21 | — |

**Cups and letters**

- A *cup* is one shop served in one round at one table. Group rounds have 3 cups per table; the final has 4.
- Each cup gets a random letter, drawn fresh per round from a pool that skips look-alikes (no I, O, Q, S, Z).
- Letters never repeat across rounds within an event, so nobody can follow a letter from round to round.
- The final draws from the sealed second drink of each finalist and gets new letters.

**Panel assignment**

- On join, the app assigns the next panel in a balanced order (Red, Blue, Green, Yellow, repeat) until sizes hit 5/5/5/6.
- The host can move a taster between panels before Round 1 opens (couples or friends split up, a late arrival).

## Taster flow

A taster scans one QR code, gets a panel colour, and then only ever sees the round in front of them: letters, a placemat order, and a ranking list.

1. **Join.** Scan the event QR code, enter a first name (unique per event; the app appends an initial on clashes). The app shows the panel colour full-screen so the host can hand out the matching sticker.
2. **Wait.** A holding screen: "Your next round: Round 1 at Table 1" or "You're resting this round." It updates live when the host opens a round.
3. **Set out cups.** When a round opens for their panel, the screen shows their placemat order, e.g. "Left to right: K · R · D".
4. **Taste and rank.** Drag the letters into order, 1st at the top. Every cup must be placed; no ties.
5. **Notes (optional).** Per cup: free text (280 characters) and quick tags — sweet, not sweet enough, strong tea, weak tea, creamy, watery, chewy pearls, hard pearls, mushy pearls.
6. **Submit.** A confirm step shows the ranking once more. After submit the ranking locks; notes stay editable until the round closes.
7. **Final.** Same screen with 4 cups.
8. **Reveal.** After the host ends the event, each taster's phone shows their own rankings with shop names, next to the group result.

**Rules the UI enforces**

- No results, counts or other votes on a taster's screen before the reveal.
- A taster can only submit for a round their panel is in, once.
- Losing the connection keeps the draft on the phone and submits when it's back.

## Blinding

The shop-to-letter mapping exists only on the server; the bagger holds one half (shop → number) and each labeller the other (number → letter), so both can taste.

**Bagger screen**

- **Check-in:** a list of the 12 shops. Tapping a shop as its bags arrive assigns it a random unused number 1–12 and shows it large, to write on the bags. Logs arrival time.
- **Pour list per round:** "Table 1: pour #7, #2, #11 — 10 cups each. Table 2: pour #4, #9, #1 — 11 cups each." Numbers only, cup counts from panel sizes.
- **Final pour list:** the 4 finalists' numbers, 21 cups each, from the sealed second drink.
- Never shows letters.

**Labeller screen (one per table)**

- Opens only for the labeller's table and the current round.
- Shows "#7 → K, #2 → R, #11 → D". The labeller covers each number with its letter and sets cups on the tray.
- Never shows shop names. Hidden again once the round closes, so the labeller can't look back.

**Letter generation**

- When the host opens a round, the server draws letters with a cryptographic RNG from the unused pool and stores the number → letter map for that round.
- The two tables in a round never share a letter.

**Placemat rotation**

- For each round, the app builds a Latin square of cup orders (3 orders for 3 cups, 4 for 4) and deals them across the panel's tasters, so each position is filled equally often by each cup.
- The taster's screen shows only their own order.

**Leaks to avoid**

- Cup letters must not follow shop order, number order or alphabetical order.
- The API never sends shop ids to taster devices; taster payloads carry only round id and letters.
- No shop names in page titles, URLs, logs on screen or error messages.

## Host controls

The host runs the event as a fixed sequence of states, and the app refuses steps out of order.

| State | Host action | What unlocks |
| --- | --- | --- |
| Setup | Enter shops, groups, panel sizes, round schedule; print join QR | Join page |
| Joining | Watch panels fill; move tasters between panels | Bagger check-in |
| Check-in | Bagger assigns numbers as drinks arrive | Round 1 (once all 12 checked in, or host overrides) |
| Round open | Open Round 1 or 2: letters drawn, labeller and taster screens go live | Votes |
| Round closed | Close when all expected votes are in, or force-close with a count shown | Scoring for that round |
| Final open | Opens only after both group rounds are scored | Final votes |
| Reveal | Step through reveal slides on the TV | Tasters' personal results |

**Live view during a round**

- Per table: "9 of 10 voted", with the names of who's missing.
- No rankings, no partial results, no shop names.

**Advancing winners**

- When a group round closes, the app scores each group, stores the winner, and adds it to the final silently.
- The host sees "Group 1 scored — winner locked" and nothing more until the reveal.
- Override: the host can reopen a round for a missing voter, which re-scores it.

**Mistakes the host can fix**

- Wrong panel at join, before Round 1 opens.
- A spilled cup: mark one taster's cup as "repoured", which keeps the letter.
- A shop that didn't arrive: withdraw it before its round opens; its group runs with 2 cups.

## Scoring

Each round is scored from full rankings by head-to-head wins, with a fixed tiebreak order so the app always produces exactly one winner.

**Algorithm (per group round and for the final)**

1. For every pair of cups A and B, count rankings with A above B and with B above A. A wins the pair if its count is higher; equal counts are a tied pair.
2. Each cup's score = pairs won (a tied pair counts 0 for both).
3. Highest score wins.
4. **Tiebreak 1:** if exactly two cups share the top score, the winner of their own pair wins.
5. **Tiebreak 2:** if that pair is tied, or three or more cups share the top score, use points: in an n-cup round, 1st = n points, 2nd = n−1, down to 1. Highest total wins.
6. **Tiebreak 3:** most 1st-place rankings.
7. **Tiebreak 4:** still tied → the app flags it and the host decides with a coin flip in the app (logged).

**Worked example: a 3-cup group, 10 voters, cups K, R, D**

| Ranking | Voters |
| --- | --- |
| K > R > D | 4 |
| R > D > K | 3 |
| D > K > R | 3 |

| Pair | Result | Winner |
| --- | --- | --- |
| K vs R | 7–3 | K |
| R vs D | 7–3 | R |
| D vs K | 6–4 | D |

Every cup has 1 win, a three-way loop, so points decide: K = 4×3 + 3×1 + 3×2 = **21**, R = 4×2 + 3×3 + 3×1 = 20, D = 4×1 + 3×2 + 3×3 = 19. **K wins.**

**Ties by group size**

- Groups judged by 11 voters and the final (21) can't have tied pairs; only loops need points.
- Groups judged by 10 voters can have tied pairs (5–5), so tiebreak 1 can fall through to points.

**Stored results**

- The full pair matrix, scores, points and which rule decided the winner, so the reveal can say "won on points".

## Reveal mode

A full-screen TV view the host steps through with a clicker or the space bar, building from the first group to the champion.

1. **Title slide:** "21 tasters · 12 shops · 4 blind groups."
2. **Group 1 to Group 4, one slide each:** first the group's theme ("The local showdown"), then on the next click the shops by name in finishing order, with head-to-head wins and 1st-place votes, and how it was decided ("won on points").
3. **Notes reel:** 3–5 short notes per group, picked by the host from a list once the final closes. Shown without names unless the taster opted in at join.
4. **Final:** the four finalists, then 4th, 3rd and 2nd revealed one per click.
5. **Champion slide:** shop name, branch, drink, vote breakdown.
6. **Fun stats:** most divisive cup (largest spread of rankings), the taster whose picks matched the overall result best, the most-used tag.

**After the reveal**

- Each taster's phone unlocks their own sheet: every cup they tasted with the shop name, their rank and the group's result.
- The host can export everything as CSV.

## Data model and API

Nine tables hold the event; the secret lives in three of them, and taster-facing endpoints never read those.

| Table | Key fields | Secret? |
| --- | --- | --- |
| `event` | id, name, date, state, join_code | No |
| `shop` | id, event_id, name, branch, order_text, group_no, secret_no, arrived_at | Yes: group_no, secret_no |
| `panel` | id, event_id, colour, size_target | No |
| `taster` | id, event_id, name, panel_id, show_name_in_reveal | No |
| `round` | id, event_id, kind (group / final), seq, state, opened_at, closed_at | No |
| `cup` | id, round_id, table_no, shop_id, letter | Yes: shop_id |
| `ballot` | id, round_id, taster_id, ranking (ordered letters), placemat_order, submitted_at | No |
| `note` | id, ballot_id, letter, text, tags[] | No |
| `result` | round_id, table_no, pair_matrix, scores, points, winner_shop_id, decided_by | Yes until reveal |

**API sketch**

| Endpoint | Caller | Returns |
| --- | --- | --- |
| `POST /join` | Taster | taster id, panel colour |
| `GET /me/round` | Taster | current round id, table, letters, placemat order, own ballot status |
| `POST /ballot` | Taster | ok; rejects duplicates or wrong panel |
| `GET /bagger/checkin`, `POST /bagger/arrive` | Bagger (PIN) | shops and numbers; never letters |
| `GET /bagger/pour?round=` | Bagger | numbers and cup counts per table |
| `GET /labeller/map?table=` | Labeller (PIN) | number → letter for the open round only |
| `POST /host/round/{id}/open`, `/close` | Host (PIN) | state; close triggers scoring |
| `GET /host/progress` | Host | votes in vs expected per table |
| `GET /reveal/{step}` | Reveal screen (host PIN) | the slide's data, only when the event is in Reveal |
| `GET /export.csv` | Host, after reveal | all ballots, notes, results with shop names |

**Live updates:** server-sent events or a websocket push round state changes to every screen, with polling every 5 s as a fallback.

**Suggested stack:** a single small web app (Next.js or SvelteKit) with SQLite or Supabase, deployed on Vercel or Fly; role screens are routes protected by per-role PINs printed on the host's setup sheet.

## Requirements, edge cases and build checklist

The app has to survive one noisy afternoon on 21 phones, so reliability and speed matter more than polish.

**Non-functional**

- Loads in under 2 s on mobile data; works on iOS Safari and Android Chrome from the last 3 years.
- Handles 21 tasters + 4 role screens + 1 TV at once with no lag on round open.
- No accounts: join by QR + name; role screens by PIN.
- Large tap targets; ranking works one-handed while holding a cup.
- Readable in a bright room; panel colours also carry their name, not colour alone.
- All writes idempotent so a double-tap or a reconnect can't create two ballots.

**Edge cases**

| Case | Behaviour |
| --- | --- |
| Taster's phone dies mid-round | Host can enter their ranking from a paper ballot on the host screen |
| Taster leaves early | Round closes on host's force-close; scoring uses ballots received |
| Late arrival | Joins any panel short of its target before Round 1; after that, joins for the final only |
| A shop doesn't arrive | Host withdraws it before its round; group runs with 2 cups |
| Spilled or wrong cup | Labeller repours under the same letter; app logs it |
| Exact tie after every rule | App flags it; host runs the in-app coin flip |
| Network drop at venue | Drafts stay on the phone; host screen shows "offline" badges |

**Build checklist**

- Event setup screen with the 12 shops, 4 groups, 4 panels and ring schedule preloaded
- Join flow with balanced panel assignment and panel moves
- Bagger check-in and pour lists
- Labeller screens with per-round letter draw
- Taster round screen: placemat order, drag-to-rank, notes, tags, submit lock
- Host round controls and live vote progress
- Scoring engine with the tiebreak chain and unit tests for loops and 5–5 pairs
- Final round seeded from group winners
- Reveal mode and personal result sheets
- CSV export
- Dry run with 4–5 people and water cups before the event
