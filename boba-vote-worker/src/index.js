// Boba Bracket voting API (Cloudflare Worker + D1).
// The page lives on GitHub Pages (food/boba-vote/); this Worker only serves /api/*.
import { scoreRound } from './scoring.js';

// Panels stay balanced for any headcount: each new taster joins the smallest panel.
const PANEL_NAMES = ['Red', 'Blue', 'Green', 'Yellow'];

// 12 shops, numbered 1-12 inside the app (the host only ever sees names and cup letters).
// Until the host taps "Generate groups", shop n sits in group ceil(n/3), which is how Bracket #1 ran.
const DEFAULT_SHOPS = ['Bubble World', 'Sharetea', 'Happy Lemon', '101 Boba', 'CoCo', 'CHICHA San Chen',
  'Chatime', 'Shiny Tea', 'Gong Cha', 'ChunFunHow', 'MACU Tea', 'SunTea'];
const SHOP_STATUSES = ['ordered', 'picked_up', 'arrived'];
const VOTING_MINUTES = 10;

// Ring schedule: each panel judges two neighbouring groups.
const PLAN = {
  1: [
    { table: 1, group: 1, panels: ['Red', 'Blue'] },
    { table: 2, group: 3, panels: ['Green', 'Yellow'] },
  ],
  2: [
    { table: 1, group: 2, panels: ['Blue', 'Green'] },
    { table: 2, group: 4, panels: ['Yellow', 'Red'] },
  ],
  3: [{ table: 1, group: null, panels: PANEL_NAMES }],
};

// Cups are lettered in order through the event: A-F round 1, G-L round 2, M-P final.
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (!url.pathname.startsWith('/api/')) return cors(json({ ok: true, app: 'boba-bracket' }));
    try {
      const res = await route(request, env, url);
      return cors(res);
    } catch (err) {
      const status = err.status || 500;
      return cors(json({ error: err.expose ? err.message : 'Server error' }, status));
    }
  },
};

async function route(request, env, url) {
  const path = url.pathname.replace(/\/+$/, '');
  const method = request.method;
  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};
  await ensureSchema(env);

  // ---------- Taster ----------
  if (path === '/api/join' && method === 'POST') return join(env, body);
  if (path === '/api/me' && method === 'GET') return me(env, url.searchParams.get('id'));
  if (path === '/api/ballot' && method === 'POST') return submitBallot(env, body, 'app');
  if (path === '/api/skip' && method === 'POST') return skipCatchup(env, body);

  // ---------- Host ----------
  if (path.startsWith('/api/host/')) {
    requirePin(request, env.HOST_PIN);
    if (path === '/api/host/state' && method === 'GET') return hostState(env);
    if (path === '/api/host/pour' && method === 'GET') return pourSheet(env);
    if (path === '/api/host/panel' && method === 'POST') return movePanel(env, body);
    if (path === '/api/host/open' && method === 'POST') return openRound(env, Number(body.round));
    if (path === '/api/host/shop' && method === 'POST') return updateShop(env, body);
    if (path === '/api/host/generate' && method === 'POST') return generateGroups(env);
    if (path === '/api/host/close' && method === 'POST') return closeRound(env, Number(body.round));
    if (path === '/api/host/paper' && method === 'POST') return submitBallot(env, body, 'paper');
    if (path === '/api/host/results' && method === 'GET') return results(env, true);
    if (path === '/api/host/unveil' && method === 'POST') return unveil(env, body);
    if (path === '/api/host/reset' && method === 'POST') return reset(env, body);
    if (path === '/api/host/theme' && method === 'POST') return setTheme(env, body);
  }
  throw httpError(404, 'Not found');
}

// ===================== Taster =====================

async function join(env, body) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) throw httpError(400, 'Enter your name');
  const existing = await env.DB.prepare('SELECT id, name, panel FROM tasters WHERE name = ?').bind(name).first();
  if (existing) return json({ taster: existing, rejoined: true });

  // Join the panel with the fewest people; ties go in panel order (Red, Blue, Green, Yellow).
  // Counting and inserting happen in one statement so people joining at the same moment still spread evenly.
  const id = crypto.randomUUID();
  const panels = PANEL_NAMES.map((p, i) => `SELECT '${p}' AS name, ${i} AS ord`).join(' UNION ALL ');
  const row = await env.DB.prepare(
    `INSERT INTO tasters (id, name, panel)
     SELECT ?, ?, (SELECT p.name FROM (${panels}) p
                   ORDER BY (SELECT COUNT(*) FROM tasters t WHERE t.panel = p.name), p.ord LIMIT 1)
     WHERE true
     ON CONFLICT (name) DO NOTHING
     RETURNING id, name, panel`,
  ).bind(id, name).first();
  if (!row) {
    // Same name joined at the same moment: hand back that person.
    const same = await env.DB.prepare('SELECT id, name, panel FROM tasters WHERE name = ?').bind(name).first();
    return json({ taster: same, rejoined: true });
  }
  return json({ taster: row, rejoined: false });
}

async function me(env, id) {
  const taster = await getTaster(env, id);
  const round = await openRoundRow(env);
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM tasters').first();
  if (!round) {
    const done = await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status = 'closed'").first();
    if (done.n === 3) {
      // Shop numbers stay off phones until the host unlocks the personal recap at the end of the reveal.
      const revealed = (await getSetting(env, 'revealed')) === '1';
      return json({ taster, state: 'finished', tasters: total.n, revealed, recap: revealed ? await recapFor(env, taster) : null });
    }
    const catchup = await catchupFor(env, taster);
    if (catchup) return json({ taster, ...catchup });
    return json({ taster, state: 'waiting', tasters: total.n, next: await nextFor(env, taster) });
  }
  const slot = PLAN[round.id].find((s) => s.panels.includes(taster.panel));
  if (!slot) {
    const catchup = await catchupFor(env, taster);
    if (catchup) return json({ taster, ...catchup });
    return json({ taster, state: 'resting', round: round.id, next: await nextFor(env, taster) });
  }

  const ballot = await env.DB.prepare('SELECT ranking FROM ballots WHERE round_id = ? AND taster_id = ?')
    .bind(round.id, taster.id).first();
  if (!ballot) {
    // A table whose late drink hasn't arrived waits; the other table goes ahead.
    if ((await lateAtTable(env, round.id, slot.table)).length) {
      return json({ taster, state: 'held', round: round.id, table: slot.table });
    }
    return json({ taster, state: 'tasting', round: round.id, table: slot.table,
      placemat: await placemat(env, round.id, slot.table, taster), ranking: null });
  }
  const catchup = await catchupFor(env, taster);
  if (catchup) return json({ taster, ...catchup });
  return json({ taster, state: 'submitted', round: round.id, table: slot.table,
    placemat: await placemat(env, round.id, slot.table, taster), ranking: JSON.parse(ballot.ranking) });
}

// A group round this taster missed (closed, no ballot from them), offered until the final opens:
// they taste the kept-aside cups and vote on their own phone.
async function catchupFor(env, taster) {
  const fin = await env.DB.prepare('SELECT status FROM rounds WHERE id = 3').first();
  if (fin.status !== 'pending') return null;
  const closed = (await env.DB.prepare("SELECT id FROM rounds WHERE status = 'closed' AND id IN (1, 2) ORDER BY id").all()).results;
  const skipped = JSON.parse((await getSetting(env, `skip:${taster.id}`)) || '[]');
  for (const r of closed) {
    if (skipped.includes(r.id)) continue;
    const slot = PLAN[r.id].find((s) => s.panels.includes(taster.panel));
    if (!slot) continue;
    const had = await env.DB.prepare('SELECT 1 AS x FROM ballots WHERE round_id = ? AND taster_id = ?').bind(r.id, taster.id).first();
    if (had) continue;
    if (!(await tableLetters(env, r.id, slot.table)).length) continue;
    return { state: 'tasting', catchup: true, round: r.id, table: slot.table,
      placemat: await placemat(env, r.id, slot.table, taster), ranking: null };
  }
  return null;
}

// Taster says they can't taste a missed round (no cups kept aside): stop offering it.
async function skipCatchup(env, body) {
  const taster = await getTaster(env, body.id);
  const roundId = Number(body.round);
  if (![1, 2].includes(roundId)) throw httpError(400, 'Unknown round');
  const key = `skip:${taster.id}`;
  const skipped = JSON.parse((await getSetting(env, key)) || '[]');
  if (!skipped.includes(roundId)) skipped.push(roundId);
  await setSetting(env, key, JSON.stringify(skipped));
  return json({ ok: true });
}

// Cup letters in tasting order for one taster: shuffled per taster, but any shop that was late
// when the groups were drawn comes last at its table, to give its drink the most time to arrive.
async function placemat(env, roundId, table, taster) {
  const cups = (await env.DB.prepare('SELECT num, letter FROM cups WHERE round_id = ? AND table_no = ?')
    .bind(roundId, table).all()).results;
  const lateNums = roundId === 3 ? new Set() : new Set(JSON.parse((await getSetting(env, 'lateAtDraw')) || '[]'));
  const early = cups.filter((c) => !lateNums.has(c.num)).map((c) => c.letter).sort();
  const late = cups.filter((c) => lateNums.has(c.num)).map((c) => c.letter).sort();
  return [...placematOrder(early, `${taster.id}:${roundId}`), ...late];
}

async function tableLetters(env, roundId, table) {
  const rows = (await env.DB.prepare('SELECT letter FROM cups WHERE round_id = ? AND table_no = ?').bind(roundId, table).all()).results;
  return rows.map((r) => r.letter);
}

// Names of shops at this table that are marked late and not yet arrived.
async function lateAtTable(env, roundId, table) {
  const rows = (await env.DB.prepare(
    'SELECT s.name FROM cups c JOIN shops s ON s.num = c.num WHERE c.round_id = ? AND c.table_no = ? AND s.late = 1',
  ).bind(roundId, table).all()).results;
  return rows.map((r) => r.name);
}

async function nextFor(env, taster) {
  const rows = await env.DB.prepare("SELECT id FROM rounds WHERE status = 'pending' ORDER BY id").all();
  for (const r of rows.results) {
    const slot = PLAN[r.id].find((s) => s.panels.includes(taster.panel));
    if (slot) return { round: r.id, table: slot.table };
  }
  return null;
}

async function submitBallot(env, body, source) {
  const taster = await getTaster(env, body.id);
  const roundId = Number(body.round);
  const round = await env.DB.prepare('SELECT id, status FROM rounds WHERE id = ?').bind(roundId).first();
  if (!round) throw httpError(400, 'Unknown round');
  // Paper ballots can be entered by the host after a round closes. App ballots need an open round,
  // or a missed group round (catch-up) while the final hasn't started.
  if (source === 'paper' && round.status === 'pending') throw httpError(409, 'This round has not started');
  if (source === 'app' && round.status !== 'open') {
    const fin = await env.DB.prepare('SELECT status FROM rounds WHERE id = 3').first();
    const catchupOk = roundId !== 3 && round.status === 'closed' && fin.status === 'pending';
    if (!catchupOk) throw httpError(409, 'This round is closed');
  }
  const slot = PLAN[roundId].find((s) => s.panels.includes(taster.panel));
  if (!slot) throw httpError(403, `${taster.panel} panel isn't tasting round ${roundId}`);
  if (source === 'app' && round.status === 'open' && (await lateAtTable(env, roundId, slot.table)).length) {
    throw httpError(409, 'Your table is waiting for a drink to arrive');
  }

  const letters = await tableLetters(env, roundId, slot.table);
  const ranking = Array.isArray(body.ranking) ? body.ranking.map((l) => String(l).toUpperCase()) : [];
  const valid = ranking.length === letters.length && new Set(ranking).size === letters.length
    && ranking.every((l) => letters.includes(l));
  if (!valid) throw httpError(400, `Rank all ${letters.length} cups: ${letters.sort().join(', ')}`);

  const notes = {};
  for (const l of letters) {
    const t = body.notes && typeof body.notes[l] === 'string' ? body.notes[l].trim().slice(0, 280) : '';
    if (t) notes[l] = t;
  }
  const res = await env.DB.prepare(
    `INSERT INTO ballots (round_id, taster_id, table_no, ranking, notes, source)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (round_id, taster_id) DO NOTHING`,
  ).bind(roundId, taster.id, slot.table, JSON.stringify(ranking), JSON.stringify(notes), source).run();
  if (!res.meta.changes) throw httpError(409, 'A ranking is already in for this round');
  return json({ ok: true });
}

// ===================== Pour sheet (host) =====================

// What to pour, for every round: each shop's name and cup letter (once drawn), whether it's late,
// and how many cups each table needs. round/status/tables = the open round (or the next one).
async function pourSheet(env) {
  const counts = await panelCounts(env);
  const rounds = (await env.DB.prepare('SELECT id, status FROM rounds ORDER BY id').all()).results;
  const cups = (await env.DB.prepare('SELECT round_id, table_no, num, letter FROM cups').all()).results;
  const shops = await allShops(env);
  const byNum = Object.fromEntries(shops.map((s) => [s.num, s]));
  const members = groupMembers(shops);
  const lateNums = new Set(JSON.parse((await getSetting(env, 'lateAtDraw')) || '[]'));
  const sheets = rounds.map((r) => ({
    round: r.id,
    status: r.status,
    tables: PLAN[r.id].map((slot) => {
      const drawn = cups.filter((c) => c.round_id === r.id && c.table_no === slot.table).sort((a, b) => a.letter.localeCompare(b.letter));
      const nums = drawn.length ? drawn.map((c) => c.num) : slot.group ? members[slot.group] : [];
      const list = nums.map((num) => ({
        num,
        name: byNum[num].name,
        letter: (drawn.find((c) => c.num === num) || {}).letter || null,
        late: !!byNum[num].late,
        lateAtDraw: r.id !== 3 && lateNums.has(num),
        status: byNum[num].status,
      }));
      return {
        table: slot.table,
        group: slot.group,
        panels: slot.panels,
        cupsEach: slot.panels.reduce((n, p) => n + (counts[p] || 0), 0),
        held: r.status === 'open' && list.some((c) => c.late),
        cups: list,
      };
    }),
  }));
  const current = rounds.find((r) => r.status === 'open') || rounds.find((r) => r.status === 'pending');
  if (!current) return json({ round: null, sheets });
  const cur = sheets.find((s) => s.round === current.id);
  return json({ round: cur.round, status: cur.status, tables: cur.tables, sheets });
}

// ===================== Host =====================

async function hostState(env) {
  const tasters = (await env.DB.prepare('SELECT id, name, panel FROM tasters ORDER BY panel, name').all()).results;
  const rounds = (await env.DB.prepare('SELECT id, status FROM rounds ORDER BY id').all()).results;
  const ballots = (await env.DB.prepare('SELECT round_id, taster_id FROM ballots').all()).results;
  const voted = new Set(ballots.map((b) => `${b.round_id}:${b.taster_id}`));
  const roundInfo = [];
  for (const r of rounds) {
    const openedAt = Number(await getSetting(env, `opened_at:${r.id}`)) || null;
    const tables = [];
    for (const slot of PLAN[r.id]) {
      const expected = tasters.filter((t) => slot.panels.includes(t.panel));
      const missing = expected.filter((t) => !voted.has(`${r.id}:${t.id}`)).map((t) => t.name);
      const waitingFor = r.status === 'open' ? await lateAtTable(env, r.id, slot.table) : [];
      tables.push({ table: slot.table, panels: slot.panels, expected: expected.length, voted: expected.length - missing.length, missing, waitingFor });
    }
    roundInfo.push({ ...r, openedAt, tables });
  }
  const shops = await allShops(env);
  return json({
    tasters,
    panels: PANEL_NAMES.map((name) => ({ name })),
    rounds: roundInfo,
    shops,
    groupsGenerated: (await getSetting(env, 'generated')) === '1',
    groupsLocked: rounds.some((r) => r.status !== 'pending'),
    now: Date.now(),
    votingMinutes: VOTING_MINUTES,
    themes: await getThemes(env),
  });
}

// Optional group themes for the TV reveal ("The 1990s pioneers"), keyed by the server's group number.
async function getThemes(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key LIKE 'theme:%'").all()).results;
  return Object.fromEntries(rows.map((r) => [r.key.slice(6), r.value]));
}

async function setTheme(env, body) {
  const group = Number(body.group);
  if (![1, 2, 3, 4].includes(group)) throw httpError(400, 'Unknown group');
  const text = String(body.theme || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (text) await setSetting(env, `theme:${group}`, text);
  else await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(`theme:${group}`).run();
  return json({ ok: true, themes: await getThemes(env) });
}

// Drinks board and shop list: rename (before round 1), mark late, or move a drink along ordered -> picked up -> arrived.
async function updateShop(env, body) {
  const num = Number(body.num);
  const shop = await env.DB.prepare('SELECT num FROM shops WHERE num = ?').bind(num).first();
  if (!shop) throw httpError(400, 'Unknown shop');
  if (typeof body.name === 'string') {
    const started = await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status != 'pending'").first();
    if (started.n > 0) throw httpError(409, 'Shop names are locked once round 1 opens');
    const name = body.name.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!name) throw httpError(400, 'Enter a shop name');
    await env.DB.prepare('UPDATE shops SET name = ? WHERE num = ?').bind(name, num).run();
  }
  if (body.status !== undefined) {
    if (!SHOP_STATUSES.includes(body.status)) throw httpError(400, 'Unknown status');
    // Arriving clears "late", which also releases a table that was waiting for this drink.
    await env.DB.prepare(`UPDATE shops SET status = ?${body.status === 'arrived' ? ', late = 0' : ''} WHERE num = ?`).bind(body.status, num).run();
  }
  if (body.late !== undefined) {
    await env.DB.prepare('UPDATE shops SET late = ? WHERE num = ?').bind(body.late ? 1 : 0, num).run();
  }
  return json({ ok: true });
}

// Draw the groups just before round 1: shops marked late go into round 2's two groups (and come last
// at their table); everything else is random. Letters for rounds 1 and 2 are assigned now, so round 2
// can be poured ahead. Can be redrawn any number of times until round 1 opens.
async function generateGroups(env) {
  const started = await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status != 'pending'").first();
  if (started.n > 0) throw httpError(409, 'Groups are locked once round 1 opens');
  const shops = await allShops(env);
  const late = shops.filter((s) => s.late).map((s) => s.num);
  const onTime = shops.filter((s) => !s.late).map((s) => s.num);
  const laterGroups = PLAN[2].map((s) => s.group);  // round 2
  const earlierGroups = PLAN[1].map((s) => s.group); // round 1
  const seatsLater = laterGroups.flatMap((g) => [g, g, g]);
  if (late.length > seatsLater.length) throw httpError(409, `At most ${seatsLater.length} late shops fit in round 2`);

  const laterSeats = shuffleSecure(seatsLater);
  const assign = {};
  shuffleSecure(late).forEach((num, i) => { assign[num] = laterSeats[i]; });
  const restSeats = shuffleSecure([...laterSeats.slice(late.length), ...earlierGroups.flatMap((g) => [g, g, g])]);
  shuffleSecure(onTime).forEach((num, i) => { assign[num] = restSeats[i]; });

  await env.DB.batch([
    ...shops.map((s) => env.DB.prepare('UPDATE shops SET grp = ? WHERE num = ?').bind(assign[s.num], s.num)),
    env.DB.prepare('DELETE FROM cups WHERE round_id IN (1, 2)'),
  ]);
  await setSetting(env, 'lateAtDraw', JSON.stringify(late));
  await setSetting(env, 'generated', '1');
  await drawLetters(env, 1);
  await drawLetters(env, 2);
  return json({ ok: true, late });
}

async function movePanel(env, body) {
  if (!PANEL_NAMES.includes(body.panel)) throw httpError(400, 'Unknown panel');
  const started = await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status != 'pending'").first();
  if (started.n > 0) throw httpError(409, 'Panels are locked once round 1 opens');
  await getTaster(env, body.id);
  await env.DB.prepare('UPDATE tasters SET panel = ? WHERE id = ?').bind(body.panel, body.id).run();
  return json({ ok: true });
}

async function openRound(env, roundId) {
  if (![1, 2, 3].includes(roundId)) throw httpError(400, 'Unknown round');
  const current = await openRoundRow(env);
  if (current && current.id !== roundId) throw httpError(409, `Close round ${current.id} first`);
  const round = await env.DB.prepare('SELECT status FROM rounds WHERE id = ?').bind(roundId).first();
  if (roundId > 1) {
    const prev = await env.DB.prepare('SELECT status FROM rounds WHERE id = ?').bind(roundId - 1).first();
    if (prev.status !== 'closed') throw httpError(409, `Round ${roundId - 1} must be closed first`);
  }

  // Opening round 1 also letters round 2, so its cups can be poured ahead.
  await drawLetters(env, roundId);
  if (roundId === 1) await drawLetters(env, 2);
  await env.DB.prepare("UPDATE rounds SET status = 'open' WHERE id = ?").bind(roundId).run();
  // The voting timer runs from the first time a round opens.
  if (!(await getSetting(env, `opened_at:${roundId}`))) await setSetting(env, `opened_at:${roundId}`, String(Date.now()));
  return json({ ok: true, round: roundId, reopened: round.status === 'closed' });
}

// Give a round's cups their letters, unless it already has them. Letters run in order through the event
// (A-F round 1, G-L round 2, M-P final); shops are shuffled within each table, and a shop that was late
// at the draw gets its table's last letter.
async function drawLetters(env, roundId) {
  const existing = await env.DB.prepare('SELECT COUNT(*) AS n FROM cups WHERE round_id = ?').bind(roundId).first();
  if (existing.n > 0) return;
  if (roundId === 2) await drawLetters(env, 1); // keep A-F for round 1
  const used = new Set((await env.DB.prepare('SELECT letter FROM cups').all()).results.map((r) => r.letter));
  const pool = LETTERS.filter((l) => !used.has(l)).reverse();
  const stmts = [];
  if (roundId === 3) {
    const winners = await groupWinners(env);
    if (winners.length !== 4) throw httpError(409, 'Rounds 1 and 2 need ballots before the final');
    shuffleSecure(winners).forEach((num) => {
      stmts.push(env.DB.prepare('INSERT INTO cups (round_id, table_no, num, letter) VALUES (3, 1, ?, ?)').bind(num, pool.pop()));
    });
  } else {
    const members = groupMembers(await allShops(env));
    const lateNums = new Set(JSON.parse((await getSetting(env, 'lateAtDraw')) || '[]'));
    for (const slot of PLAN[roundId]) {
      const nums = members[slot.group];
      const ordered = [...shuffleSecure(nums.filter((n) => !lateNums.has(n))), ...shuffleSecure(nums.filter((n) => lateNums.has(n)))];
      for (const num of ordered) {
        stmts.push(env.DB.prepare('INSERT INTO cups (round_id, table_no, num, letter) VALUES (?, ?, ?, ?)')
          .bind(roundId, slot.table, num, pool.pop()));
      }
    }
  }
  await env.DB.batch(stmts);
}

async function closeRound(env, roundId) {
  await env.DB.prepare("UPDATE rounds SET status = 'closed' WHERE id = ? AND status = 'open'").bind(roundId).run();
  return json({ ok: true });
}

async function groupWinners(env) {
  const r = await results(env, false);
  return r.groups.filter((g) => g.result && g.result.voters > 0).map((g) => g.result.winner);
}

// Results by cup number (shop names are added on the reveal screen from the paper key).
async function results(env, asResponse) {
  const cups = (await env.DB.prepare('SELECT round_id, table_no, num, letter FROM cups').all()).results;
  const ballots = (await env.DB.prepare('SELECT round_id, table_no, ranking, notes FROM ballots').all()).results;
  const rounds = Object.fromEntries((await env.DB.prepare('SELECT id, status FROM rounds').all()).results.map((r) => [r.id, r.status]));
  const tasters = (await env.DB.prepare('SELECT COUNT(*) AS n FROM tasters').first()).n;

  const scoreSlot = (roundId, table) => {
    const slotCups = cups.filter((c) => c.round_id === roundId && c.table_no === table);
    if (slotCups.length === 0) return null;
    const byLetter = Object.fromEntries(slotCups.map((c) => [c.letter, c.num]));
    const slotBallots = ballots.filter((b) => b.round_id === roundId && b.table_no === table);
    const rankings = slotBallots.map((b) => JSON.parse(b.ranking).map((l) => byLetter[l]));
    const res = scoreRound(slotCups.map((c) => c.num), rankings, seededRng(`${roundId}:${table}`));
    const notes = {};
    for (const b of slotBallots) {
      for (const [l, t] of Object.entries(JSON.parse(b.notes))) (notes[byLetter[l]] ||= []).push(t);
    }
    return { ...res, letters: Object.fromEntries(slotCups.map((c) => [c.num, c.letter])), notes };
  };

  const shopRows = await allShops(env);
  const groups = [];
  for (const roundId of [1, 2]) {
    for (const slot of PLAN[roundId]) {
      const members = shopRows.filter((s) => s.grp === slot.group).map((s) => s.num);
      groups.push({ round: roundId, table: slot.table, group: slot.group, panels: slot.panels, members, status: rounds[roundId], result: scoreSlot(roundId, slot.table) });
    }
  }
  groups.sort((a, b) => a.group - b.group);
  const shops = Object.fromEntries(shopRows.map((s) => [s.num, s.name]));
  const data = { tasters, groups, final: { status: rounds[3], result: scoreSlot(3, 1) }, shops };
  if (!asResponse) return data;
  data.revealed = (await getSetting(env, 'revealed')) === '1';
  data.themes = await getThemes(env);
  return json(data);
}

// Host unlocks (or hides again) each taster's personal recap on their phone.
async function unveil(env, body) {
  const on = body.on !== false;
  if (on) {
    const fin = await env.DB.prepare('SELECT status FROM rounds WHERE id = 3').first();
    if (fin.status !== 'closed') throw httpError(409, 'Close the final first');
  }
  await setSetting(env, 'revealed', on ? '1' : '0');
  return json({ ok: true, revealed: on });
}

// One taster's own ballots with the cups unmasked: their order, each shop's place in that group, their notes.
async function recapFor(env, taster) {
  const r = await results(env, false);
  const mine = (await env.DB.prepare('SELECT round_id, table_no, ranking, notes FROM ballots WHERE taster_id = ? ORDER BY round_id')
    .bind(taster.id).all()).results;
  const rounds = [];
  for (const b of mine) {
    const res = b.round_id === 3 ? r.final.result : (r.groups.find((g) => g.round === b.round_id && g.table === b.table_no) || {}).result;
    if (!res) continue;
    const byLetter = Object.fromEntries(Object.entries(res.letters).map(([num, l]) => [l, Number(num)]));
    const notes = JSON.parse(b.notes);
    rounds.push({
      round: b.round_id,
      table: b.table_no,
      group: b.round_id === 3 ? null : PLAN[b.round_id].find((s) => s.table === b.table_no).group,
      voters: res.voters,
      winner: res.winner,
      picks: JSON.parse(b.ranking).map((l) => ({ letter: l, num: byLetter[l], place: res.order.indexOf(byLetter[l]) + 1, note: notes[l] || '' })),
    });
  }
  return { rounds, champion: r.final.result ? r.final.result.winner : null, shops: r.shops };
}

async function reset(env, body) {
  if (body.confirm !== 'RESET') throw httpError(400, 'Type RESET to confirm');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ballots'),
    env.DB.prepare('DELETE FROM cups'),
    env.DB.prepare('DELETE FROM tasters'),
    env.DB.prepare("UPDATE rounds SET status = 'pending'"),
    // Shop names stay; groups go back to the default, and late flags and drink statuses clear.
    env.DB.prepare("UPDATE shops SET grp = (num + 2) / 3, late = 0, status = 'ordered'"),
    env.DB.prepare("DELETE FROM settings WHERE key != 'revealed'"),
  ]);
  await setSetting(env, 'revealed', '0');
  return json({ ok: true });
}

// Tables the app added after Bracket #1 (settings, shops) are created on first use,
// so the live database needs no manual migration. The shops seed with Bracket #1's groups.
let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS shops (
      num INTEGER PRIMARY KEY, name TEXT NOT NULL, grp INTEGER NOT NULL,
      late INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ordered')`),
  ]);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM shops').first();
  if (n.n === 0) {
    await env.DB.batch(DEFAULT_SHOPS.map((name, i) => env.DB.prepare(
      'INSERT INTO shops (num, name, grp) VALUES (?, ?, ?) ON CONFLICT (num) DO NOTHING',
    ).bind(i + 1, name, Math.ceil((i + 1) / 3))));
  }
  schemaReady = true;
}
async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, value).run();
}

async function allShops(env) {
  const rows = (await env.DB.prepare('SELECT num, name, grp, late, status FROM shops ORDER BY num').all()).results;
  return rows.map((r) => ({ ...r, late: !!r.late }));
}

// group number -> the shop numbers in it
function groupMembers(shops) {
  const m = {};
  for (const s of shops) (m[s.grp] ||= []).push(s.num);
  return m;
}

// ===================== Helpers =====================

async function getTaster(env, id) {
  if (!id) throw httpError(400, 'Join first');
  const t = await env.DB.prepare('SELECT id, name, panel FROM tasters WHERE id = ?').bind(String(id)).first();
  if (!t) throw httpError(404, 'We lost your spot, please join again');
  return t;
}

async function panelCounts(env) {
  const rows = await env.DB.prepare('SELECT panel, COUNT(*) AS n FROM tasters GROUP BY panel').all();
  return Object.fromEntries(rows.results.map((r) => [r.panel, r.n]));
}

async function openRoundRow(env) {
  return env.DB.prepare("SELECT id, status FROM rounds WHERE status = 'open' ORDER BY id LIMIT 1").first();
}

// Same order every time for the same taster and round, different across tasters.
function placematOrder(letters, seed) {
  return shuffleWith(letters, seededRng(seed));
}

function seededRng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWith(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleSecure(arr) {
  const buf = new Uint32Array(arr.length);
  crypto.getRandomValues(buf);
  let k = 0;
  return shuffleWith(arr, () => buf[k++ % buf.length] / 4294967296);
}

function requirePin(request, pin) {
  const given = request.headers.get('X-Pin') || '';
  if (!pin || given !== pin) throw httpError(401, 'Wrong PIN');
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function cors(res) {
  const r = new Response(res.body, res);
  r.headers.set('Access-Control-Allow-Origin', '*');
  r.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  r.headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Pin');
  r.headers.set('Access-Control-Max-Age', '86400');
  return r;
}
