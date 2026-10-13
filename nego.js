// FoE Reader – nego.js
// Pomocník pro vyjednávání (Mastermind): z dosavadních tahů vyřadí nemožné kombinace a navrhne další tah.
// Pouze počítá – nic neodesílá, tah zadává hráč sám.
//
// Pravidla odvozená z logu (expedice, 10/2026):
//  - každá postava (slot) chce právě jedno zboží, zboží se může opakovat;
//  - posílají se jen nevyřešené sloty; vyřešený slot (correct) už se neposílá ani nepočítá;
//  - correct = slot chce právě toto zboží;
//  - wrong_person = zboží chce jiná postava, která v tomto tahu správné zboží nedostala
//    (bio na slotech 2, 3, 4, chtěly ho 2 a 4 → obě correct, slot 3 not_needed; porifera na 2 slotech,
//    chtěla ji jen jedna jiná postava → oba sloty wrong_person, tedy bez omezení počtem);
//  - not_needed = žádná další poptávka.
(() => {
  'use strict';

  // secret: pole indexů zboží pro všech 5 slotů; open: indexy otevřených slotů;
  // guess: Map slot -> zboží. Vrací Map slot -> 'correct' | 'wrong_person' | 'not_needed'.
  // wrong_person = zboží chce jiná otevřená postava, která v tomto tahu nedostala správné zboží
  // (bez omezení počtem – log 13. 10.: porifera na 2 slotech, obě ↔, chtěla ji jen jedna postava).
  function feedback(secret, open, guess) {
    const out = new Map();
    const correct = new Set();
    for (const [slot, g] of guess) if (secret[slot] === g) correct.add(slot);
    for (const [slot, g] of guess) {
      if (correct.has(slot)) { out.set(slot, 'correct'); continue; }
      let wp = false;
      for (const j of open) if (j !== slot && !correct.has(j) && secret[j] === g) { wp = true; break; }
      out.set(slot, wp ? 'wrong_person' : 'not_needed');
    }
    return out;
  }

  const key = (fb) => { let k = ''; for (const v of fb.values()) k += v[0]; return k; };

  // Odpovídá kandidát pozorovanému tahu?
  function consistent(secret, turn) {
    const fb = feedback(secret, turn.open, turn.guess);
    for (const [slot, st] of turn.result) if (fb.get(slot) !== st) return false;
    return true;
  }

  function allSecrets(nGoods, slots, fixed) {
    const out = [];
    const cur = new Array(slots).fill(0);
    (function rec(i) {
      if (i === slots) { out.push(cur.slice()); return; }
      if (fixed.has(i)) { cur[i] = fixed.get(i); rec(i + 1); return; }
      for (let g = 0; g < nGoods; g++) { cur[i] = g; rec(i + 1); }
    })(0);
    return out;
  }

  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  // Hlavní funkce. game = {nGoods, slots, turns:[{open:[..], guess:Map, result:Map}], turnsLeft}
  function solve(game) {
    const { nGoods, slots, turns } = game;
    const fixed = new Map();
    for (const t of turns) for (const [slot, st] of t.result) if (st === 'correct') fixed.set(slot, t.guess.get(slot));
    let cands = allSecrets(nGoods, slots, fixed);
    for (const t of turns) cands = cands.filter((c) => consistent(c, t));
    const open = [...Array(slots).keys()].filter((s) => !fixed.has(s));
    const res = { cands: cands.length, open, fixed, suggestion: null, sure: false, slotProb: [] };
    // pravděpodobnost zboží na každém otevřeném slotu (pro zobrazení)
    for (const s of open) {
      const cnt = new Array(nGoods).fill(0);
      for (const c of cands) cnt[c[s]]++;
      res.slotProb[s] = cnt.map((n) => (cands.length ? n / cands.length : 0));
    }
    if (!cands.length || !open.length) return res;
    if (cands.length === 1 || (game.turnsLeft != null && game.turnsLeft <= 1)) {
      res.suggestion = new Map(open.map((s) => [s, cands[0][s]]));
      res.sure = cands.length === 1;
      return res;
    }
    // Kandidátní tahy: všichni kandidáti (do limitu) + náhodné tahy; hodnocení = očekávaná velikost zbytku.
    const rnd = rng(cands.length * 7919 + turns.length);
    const sample = cands.length > 1200 ? Array.from({ length: 1200 }, () => cands[Math.floor(rnd() * cands.length)]) : cands;
    const pool = [];
    const poolCands = cands.length > 400 ? Array.from({ length: 400 }, () => cands[Math.floor(rnd() * cands.length)]) : cands;
    for (const c of poolCands) pool.push({ g: new Map(open.map((s) => [s, c[s]])), isCand: true });
    for (let i = 0; i < 300; i++) pool.push({ g: new Map(open.map((s) => [s, Math.floor(rnd() * nGoods)])), isCand: false });
    // první tah: co nejvíc různého zboží
    if (!turns.length) for (let off = 0; off < nGoods; off++) pool.push({ g: new Map(open.map((s, i) => [s, (i + off) % nGoods])), isCand: false });
    const candKeys = new Set(cands.map((c) => open.map((s) => c[s]).join(',')));
    let best = null;
    for (const p of pool) {
      const parts = new Map();
      for (const c of sample) { const k = key(feedback(c, open, p.g)); parts.set(k, (parts.get(k) || 0) + 1); }
      let score = 0;
      for (const n of parts.values()) score += n * n;
      const isCand = candKeys.has(open.map((s) => p.g.get(s)).join(','));
      const val = score / sample.length - (isCand ? 0.5 : 0); // kandidát může rovnou vyhrát
      if (!best || val < best.val) best = { val, g: p.g };
    }
    res.suggestion = best.g;
    return res;
  }

  globalThis.FOE_NEGO = { solve, feedback, consistent };
})();
