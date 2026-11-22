// src/scoring.js
function scoreRound(cupIds, rankings, rng = Math.random) {
  const n = cupIds.length;
  const ballots = rankings.filter(
    (r) => Array.isArray(r) && r.length === n && cupIds.every((c) => r.includes(c))
  );
  const pos = ballots.map((r) => Object.fromEntries(r.map((c, i) => [c, i])));
  const stats = Object.fromEntries(
    cupIds.map((c) => [c, { cup: c, wins: 0, losses: 0, ties: 0, points: 0, firsts: 0, ranks: [] }])
  );
  const pairs = {};
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = cupIds[i];
      const b = cupIds[j];
      let aOver = 0;
      let bOver = 0;
      for (const p of pos) {
        if (p[a] < p[b]) aOver++;
        else bOver++;
      }
      pairs[`${a}|${b}`] = { a, b, aOver, bOver };
      if (aOver > bOver) {
        stats[a].wins++;
        stats[b].losses++;
      } else if (bOver > aOver) {
        stats[b].wins++;
        stats[a].losses++;
      } else {
        stats[a].ties++;
        stats[b].ties++;
      }
    }
  }
  for (const p of pos) {
    for (const c of cupIds) {
      const rank = p[c] + 1;
      stats[c].points += n - p[c];
      stats[c].ranks.push(rank);
      if (rank === 1) stats[c].firsts++;
    }
  }
  const h2h = (a, b) => {
    const key = pairs[`${a}|${b}`] ? `${a}|${b}` : `${b}|${a}`;
    const pr = pairs[key];
    const aOver = pr.a === a ? pr.aOver : pr.bOver;
    const bOver = pr.a === a ? pr.bOver : pr.aOver;
    return aOver - bOver;
  };
  const coinFlips = [];
  const breakTie = (block) => {
    if (block.length === 1) return { order: block, rule: null };
    if (block.length === 2) {
      const d = h2h(block[0], block[1]);
      if (d !== 0) return { order: d > 0 ? block : [block[1], block[0]], rule: "head-to-head" };
    }
    const byPoints = groupBy(block, (c) => stats[c].points);
    if (byPoints.length > 1 || byPoints[0].length === 1) {
      const order2 = [];
      let rule = "points";
      for (const g of byPoints) {
        const sub = g.length === 1 ? { order: g } : breakFirsts(g);
        if (order2.length === 0 && g.length > 1) rule = sub.rule;
        order2.push(...sub.order);
      }
      return { order: order2, rule };
    }
    return breakFirsts(block);
  };
  const breakFirsts = (block) => {
    const byFirsts = groupBy(block, (c) => stats[c].firsts);
    const order2 = [];
    let rule = "first-place votes";
    for (const g of byFirsts) {
      if (g.length === 1) order2.push(...g);
      else {
        const shuffled = shuffle(g, rng);
        coinFlips.push(shuffled);
        if (order2.length === 0) rule = "coin flip";
        order2.push(...shuffled);
      }
    }
    return { order: order2, rule };
  };
  const byWins = groupBy(cupIds, (c) => stats[c].wins);
  const order = [];
  let decidedBy = "head-to-head wins";
  byWins.forEach((g, idx) => {
    const res = breakTie(g);
    if (idx === 0 && g.length > 1) decidedBy = res.rule;
    order.push(...res.order);
  });
  return {
    voters: ballots.length,
    order,
    winner: order[0],
    decidedBy,
    coinFlip: coinFlips.length > 0,
    stats: order.map((c) => stats[c]),
    pairs: Object.values(pairs)
  };
}
function groupBy(items, keyFn) {
  const m = /* @__PURE__ */ new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return [...m.entries()].sort((x, y) => y[0] - x[0]).map(([, v]) => v);
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// src/index.js
var PANEL_NAMES = ["Red", "Blue", "Green", "Yellow"];
var groupNums = (g) => [3 * g - 2, 3 * g - 1, 3 * g];
var PLAN = {
  1: [
    { table: 1, group: 1, panels: ["Red", "Blue"] },
    { table: 2, group: 3, panels: ["Green", "Yellow"] }
  ],
  2: [
    { table: 1, group: 2, panels: ["Blue", "Green"] },
    { table: 2, group: 4, panels: ["Yellow", "Red"] }
  ],
  3: [{ table: 1, group: null, panels: PANEL_NAMES }]
};
var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (!url.pathname.startsWith("/api/")) return cors(json({ ok: true, app: "boba-bracket" }));
    try {
      const res = await route(request, env, url);
      return cors(res);
    } catch (err) {
      const status = err.status || 500;
      return cors(json({ error: err.expose ? err.message : "Server error" }, status));
    }
  }
};
async function route(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  const body = method === "POST" ? await request.json().catch(() => ({})) : {};
  if (path === "/api/join" && method === "POST") return join(env, body);
  if (path === "/api/me" && method === "GET") return me(env, url.searchParams.get("id"));
  if (path === "/api/ballot" && method === "POST") return submitBallot(env, body, "app");
  if (path.startsWith("/api/host/")) {
    requirePin(request, env.HOST_PIN);
    if (path === "/api/host/state" && method === "GET") return hostState(env);
    if (path === "/api/host/pour" && method === "GET") return pourSheet(env);
    if (path === "/api/host/panel" && method === "POST") return movePanel(env, body);
    if (path === "/api/host/open" && method === "POST") return openRound(env, Number(body.round));
    if (path === "/api/host/close" && method === "POST") return closeRound(env, Number(body.round));
    if (path === "/api/host/paper" && method === "POST") return submitBallot(env, body, "paper");
    if (path === "/api/host/results" && method === "GET") return results(env, true);
    if (path === "/api/host/unveil" && method === "POST") return unveil(env, body);
    if (path === "/api/host/reset" && method === "POST") return reset(env, body);
  }
  throw httpError(404, "Not found");
}
async function join(env, body) {
  const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (!name) throw httpError(400, "Enter your name");
  const existing = await env.DB.prepare("SELECT id, name, panel FROM tasters WHERE name = ?").bind(name).first();
  if (existing) return json({ taster: existing, rejoined: true });
  const counts = await panelCounts(env);
  let best = null;
  for (const name2 of PANEL_NAMES) {
    const n = counts[name2] || 0;
    if (!best || n < best.n) best = { name: name2, n };
  }
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO tasters (id, name, panel) VALUES (?, ?, ?)").bind(id, name, best.name).run();
  return json({ taster: { id, name, panel: best.name }, rejoined: false });
}
async function me(env, id) {
  const taster = await getTaster(env, id);
  const round = await openRoundRow(env);
  const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM tasters").first();
  if (!round) {
    const done = await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status = 'closed'").first();
    if (done.n === 3) {
      const revealed = await getSetting(env, "revealed") === "1";
      return json({ taster, state: "finished", tasters: total.n, revealed, recap: revealed ? await recapFor(env, taster) : null });
    }
    return json({ taster, state: "waiting", tasters: total.n, next: await nextFor(env, taster) });
  }
  const slot = PLAN[round.id].find((s) => s.panels.includes(taster.panel));
  if (!slot) return json({ taster, state: "resting", round: round.id, next: await nextFor(env, taster) });
  const cups = await env.DB.prepare("SELECT letter FROM cups WHERE round_id = ? AND table_no = ?").bind(round.id, slot.table).all();
  const letters = cups.results.map((c) => c.letter).sort();
  const ballot = await env.DB.prepare("SELECT ranking FROM ballots WHERE round_id = ? AND taster_id = ?").bind(round.id, taster.id).first();
  return json({
    taster,
    state: ballot ? "submitted" : "tasting",
    round: round.id,
    table: slot.table,
    placemat: placematOrder(letters, `${taster.id}:${round.id}`),
    ranking: ballot ? JSON.parse(ballot.ranking) : null
  });
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
  const round = await env.DB.prepare("SELECT id, status FROM rounds WHERE id = ?").bind(roundId).first();
  if (!round) throw httpError(400, "Unknown round");
  if (source === "app" && round.status !== "open") throw httpError(409, "This round is closed");
  if (source === "paper" && round.status === "pending") throw httpError(409, "This round has not started");
  const slot = PLAN[roundId].find((s) => s.panels.includes(taster.panel));
  if (!slot) throw httpError(403, `${taster.panel} panel isn't tasting round ${roundId}`);
  const cups = await env.DB.prepare("SELECT letter FROM cups WHERE round_id = ? AND table_no = ?").bind(roundId, slot.table).all();
  const letters = cups.results.map((c) => c.letter);
  const ranking = Array.isArray(body.ranking) ? body.ranking.map((l) => String(l).toUpperCase()) : [];
  const valid = ranking.length === letters.length && new Set(ranking).size === letters.length && ranking.every((l) => letters.includes(l));
  if (!valid) throw httpError(400, `Rank all ${letters.length} cups: ${letters.sort().join(", ")}`);
  const notes = {};
  for (const l of letters) {
    const t = body.notes && typeof body.notes[l] === "string" ? body.notes[l].trim().slice(0, 280) : "";
    if (t) notes[l] = t;
  }
  const res = await env.DB.prepare(
    `INSERT INTO ballots (round_id, taster_id, table_no, ranking, notes, source)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (round_id, taster_id) DO NOTHING`
  ).bind(roundId, taster.id, slot.table, JSON.stringify(ranking), JSON.stringify(notes), source).run();
  if (!res.meta.changes) throw httpError(409, "A ranking is already in for this round");
  return json({ ok: true });
}
async function pourSheet(env) {
  const counts = await panelCounts(env);
  const round = await openRoundRow(env) || await nextPendingRound(env);
  if (!round) return json({ round: null });
  const cups = (await env.DB.prepare("SELECT table_no, num, letter FROM cups WHERE round_id = ?").bind(round.id).all()).results;
  const tables = PLAN[round.id].map((slot) => {
    const drawn = cups.filter((c) => c.table_no === slot.table).sort((a, b) => a.letter.localeCompare(b.letter));
    const nums = drawn.length ? drawn.map((c) => c.num) : slot.group ? groupNums(slot.group) : [];
    return {
      table: slot.table,
      panels: slot.panels,
      cupsEach: slot.panels.reduce((n, p) => n + (counts[p] || 0), 0),
      cups: nums.map((num) => ({ num, letter: (drawn.find((c) => c.num === num) || {}).letter || null }))
    };
  });
  return json({ round: round.id, status: round.status, tables });
}
async function hostState(env) {
  const tasters = (await env.DB.prepare("SELECT id, name, panel FROM tasters ORDER BY panel, name").all()).results;
  const rounds = (await env.DB.prepare("SELECT id, status FROM rounds ORDER BY id").all()).results;
  const ballots = (await env.DB.prepare("SELECT round_id, taster_id FROM ballots").all()).results;
  const voted = new Set(ballots.map((b) => `${b.round_id}:${b.taster_id}`));
  const roundInfo = rounds.map((r) => ({
    ...r,
    tables: PLAN[r.id].map((slot) => {
      const expected = tasters.filter((t) => slot.panels.includes(t.panel));
      const missing = expected.filter((t) => !voted.has(`${r.id}:${t.id}`)).map((t) => t.name);
      return { table: slot.table, panels: slot.panels, expected: expected.length, voted: expected.length - missing.length, missing };
    })
  }));
  return json({ tasters, panels: PANEL_NAMES.map((name) => ({ name })), rounds: roundInfo });
}
async function movePanel(env, body) {
  if (!PANEL_NAMES.includes(body.panel)) throw httpError(400, "Unknown panel");
  const started = await env.DB.prepare("SELECT COUNT(*) AS n FROM rounds WHERE status != 'pending'").first();
  if (started.n > 0) throw httpError(409, "Panels are locked once round 1 opens");
  await getTaster(env, body.id);
  await env.DB.prepare("UPDATE tasters SET panel = ? WHERE id = ?").bind(body.panel, body.id).run();
  return json({ ok: true });
}
async function openRound(env, roundId) {
  if (![1, 2, 3].includes(roundId)) throw httpError(400, "Unknown round");
  const current = await openRoundRow(env);
  if (current && current.id !== roundId) throw httpError(409, `Close round ${current.id} first`);
  const round = await env.DB.prepare("SELECT status FROM rounds WHERE id = ?").bind(roundId).first();
  if (roundId > 1) {
    const prev = await env.DB.prepare("SELECT status FROM rounds WHERE id = ?").bind(roundId - 1).first();
    if (prev.status !== "closed") throw httpError(409, `Round ${roundId - 1} must be closed first`);
  }
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM cups WHERE round_id = ?").bind(roundId).first();
  if (existing.n === 0) {
    const used = new Set((await env.DB.prepare("SELECT letter FROM cups").all()).results.map((r) => r.letter));
    const pool = LETTERS.filter((l) => !used.has(l)).reverse();
    const stmts = [];
    if (roundId === 3) {
      const winners = await groupWinners(env);
      if (winners.length !== 4) throw httpError(409, "Rounds 1 and 2 need ballots before the final");
      shuffleSecure(winners).forEach((num) => {
        stmts.push(env.DB.prepare("INSERT INTO cups (round_id, table_no, num, letter) VALUES (3, 1, ?, ?)").bind(num, pool.pop()));
      });
    } else {
      for (const slot of PLAN[roundId]) {
        for (const num of shuffleSecure(groupNums(slot.group))) {
          stmts.push(env.DB.prepare("INSERT INTO cups (round_id, table_no, num, letter) VALUES (?, ?, ?, ?)").bind(roundId, slot.table, num, pool.pop()));
        }
      }
    }
    await env.DB.batch(stmts);
  }
  await env.DB.prepare("UPDATE rounds SET status = 'open' WHERE id = ?").bind(roundId).run();
  return json({ ok: true, round: roundId, reopened: round.status === "closed" });
}
async function closeRound(env, roundId) {
  await env.DB.prepare("UPDATE rounds SET status = 'closed' WHERE id = ? AND status = 'open'").bind(roundId).run();
  return json({ ok: true });
}
async function groupWinners(env) {
  const r = await results(env, false);
  return r.groups.filter((g) => g.result && g.result.voters > 0).map((g) => g.result.winner);
}
async function results(env, asResponse) {
  const cups = (await env.DB.prepare("SELECT round_id, table_no, num, letter FROM cups").all()).results;
  const ballots = (await env.DB.prepare("SELECT round_id, table_no, ranking, notes FROM ballots").all()).results;
  const rounds = Object.fromEntries((await env.DB.prepare("SELECT id, status FROM rounds").all()).results.map((r) => [r.id, r.status]));
  const tasters = (await env.DB.prepare("SELECT COUNT(*) AS n FROM tasters").first()).n;
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
  const groups = [];
  for (const roundId of [1, 2]) {
    for (const slot of PLAN[roundId]) {
      groups.push({ round: roundId, table: slot.table, group: slot.group, panels: slot.panels, status: rounds[roundId], result: scoreSlot(roundId, slot.table) });
    }
  }
  groups.sort((a, b) => a.group - b.group);
  const data = { tasters, groups, final: { status: rounds[3], result: scoreSlot(3, 1) } };
  if (!asResponse) return data;
  data.revealed = await getSetting(env, "revealed") === "1";
  return json(data);
}
async function unveil(env, body) {
  const on = body.on !== false;
  if (on) {
    const fin = await env.DB.prepare("SELECT status FROM rounds WHERE id = 3").first();
    if (fin.status !== "closed") throw httpError(409, "Close the final first");
  }
  await setSetting(env, "revealed", on ? "1" : "0");
  return json({ ok: true, revealed: on });
}
async function recapFor(env, taster) {
  const r = await results(env, false);
  const mine = (await env.DB.prepare("SELECT round_id, table_no, ranking, notes FROM ballots WHERE taster_id = ? ORDER BY round_id").bind(taster.id).all()).results;
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
      picks: JSON.parse(b.ranking).map((l) => ({ letter: l, num: byLetter[l], place: res.order.indexOf(byLetter[l]) + 1, note: notes[l] || "" }))
    });
  }
  return { rounds, champion: r.final.result ? r.final.result.winner : null };
}
async function reset(env, body) {
  if (body.confirm !== "RESET") throw httpError(400, "Type RESET to confirm");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ballots"),
    env.DB.prepare("DELETE FROM cups"),
    env.DB.prepare("DELETE FROM tasters"),
    env.DB.prepare("UPDATE rounds SET status = 'pending'")
  ]);
  await setSetting(env, "revealed", "0");
  return json({ ok: true });
}
var settingsReady = false;
async function ensureSettings(env) {
  if (settingsReady) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  settingsReady = true;
}
async function getSetting(env, key) {
  await ensureSettings(env);
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}
async function setSetting(env, key, value) {
  await ensureSettings(env);
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}
async function getTaster(env, id) {
  if (!id) throw httpError(400, "Join first");
  const t = await env.DB.prepare("SELECT id, name, panel FROM tasters WHERE id = ?").bind(String(id)).first();
  if (!t) throw httpError(404, "We lost your spot, please join again");
  return t;
}
async function panelCounts(env) {
  const rows = await env.DB.prepare("SELECT panel, COUNT(*) AS n FROM tasters GROUP BY panel").all();
  return Object.fromEntries(rows.results.map((r) => [r.panel, r.n]));
}
async function openRoundRow(env) {
  return env.DB.prepare("SELECT id, status FROM rounds WHERE status = 'open' ORDER BY id LIMIT 1").first();
}
async function nextPendingRound(env) {
  return env.DB.prepare("SELECT id, status FROM rounds WHERE status = 'pending' ORDER BY id LIMIT 1").first();
}
function placematOrder(letters, seed) {
  return shuffleWith(letters, seededRng(seed));
}
function seededRng(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 1831565813;
    let t = h;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
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
  const given = request.headers.get("X-Pin") || "";
  if (!pin || given !== pin) throw httpError(401, "Wrong PIN");
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
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function cors(res) {
  const r = new Response(res.body, res);
  r.headers.set("Access-Control-Allow-Origin", "*");
  r.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  r.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Pin");
  r.headers.set("Access-Control-Max-Age", "86400");
  return r;
}
export {
  index_default as default
};
