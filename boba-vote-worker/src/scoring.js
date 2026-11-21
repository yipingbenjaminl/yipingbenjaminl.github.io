// Scoring for one round: rankings are arrays of cup ids, best first.
// Rule chain (matches the round 1 plan):
//   1. Most head-to-head wins (A beats B if more voters ranked A above B).
//   2. Two leaders tied on wins: their own head-to-head.
//   3. Still tied, or 3+ tied: points (n for 1st ... 1 for last).
//   4. Still tied: most 1st-place votes.
//   5. Still tied: coin flip (flagged).

export function scoreRound(cupIds, rankings, rng = Math.random) {
  const n = cupIds.length;
  const ballots = rankings.filter(
    (r) => Array.isArray(r) && r.length === n && cupIds.every((c) => r.includes(c)),
  );
  const pos = ballots.map((r) => Object.fromEntries(r.map((c, i) => [c, i])));

  const stats = Object.fromEntries(
    cupIds.map((c) => [c, { cup: c, wins: 0, losses: 0, ties: 0, points: 0, firsts: 0, ranks: [] }]),
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
      if (aOver > bOver) { stats[a].wins++; stats[b].losses++; }
      else if (bOver > aOver) { stats[b].wins++; stats[a].losses++; }
      else { stats[a].ties++; stats[b].ties++; }
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

  // Order everyone: wins, then the tiebreak chain within each tied block.
  const coinFlips = [];
  const breakTie = (block) => {
    // Returns block ordered best-first plus how the top was decided.
    if (block.length === 1) return { order: block, rule: null };
    if (block.length === 2) {
      const d = h2h(block[0], block[1]);
      if (d !== 0) return { order: d > 0 ? block : [block[1], block[0]], rule: 'head-to-head' };
    }
    const byPoints = groupBy(block, (c) => stats[c].points);
    if (byPoints.length > 1 || byPoints[0].length === 1) {
      const order = [];
      let rule = 'points';
      for (const g of byPoints) {
        const sub = g.length === 1 ? { order: g } : breakFirsts(g);
        if (order.length === 0 && g.length > 1) rule = sub.rule;
        order.push(...sub.order);
      }
      return { order, rule };
    }
    return breakFirsts(block);
  };
  const breakFirsts = (block) => {
    const byFirsts = groupBy(block, (c) => stats[c].firsts);
    const order = [];
    let rule = 'first-place votes';
    for (const g of byFirsts) {
      if (g.length === 1) order.push(...g);
      else {
        const shuffled = shuffle(g, rng);
        coinFlips.push(shuffled);
        if (order.length === 0) rule = 'coin flip';
        order.push(...shuffled);
      }
    }
    return { order, rule };
  };

  const byWins = groupBy(cupIds, (c) => stats[c].wins);
  const order = [];
  let decidedBy = 'head-to-head wins';
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
    pairs: Object.values(pairs),
  };
}

function groupBy(items, keyFn) {
  // Groups items by key, highest key first.
  const m = new Map();
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
