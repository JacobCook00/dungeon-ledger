/* Dungeon Ledger dice engine — pure, no dependencies.
   Grammar:  expr  = ['+'|'-'] term (('+'|'-') term)*
             term  = number | [count] 'd' (sides|'%') modifier*
             modifier = '!' | ('kh'|'kl'|'dh'|'dl'|'k') N | 'r' [N] | ('>'|'<') ['='] N
   '!' explodes on max; rN rerolls once any die <= N (default 1);
   keep/drop apply after explosion; >N / <N switch the term to success counting
   (strict: >7 with a 7 is a failure; use >=7 to include it). */
(function (g) {
  'use strict';
  const MAX_DICE = 1000, MAX_SIDES = 10000, MAX_EXPLODE = 100;

  class DiceError extends Error {
    constructor(message, index) { super(message); this.name = 'DiceError'; this.index = index; }
  }

  function roll(input, rng) {
    rng = rng || Math.random;
    const s = String(input == null ? '' : input).toLowerCase();
    let i = 0;
    const ws = () => { while (s[i] === ' ' || s[i] === '\t') i++; };
    const num = () => {
      ws(); const st = i;
      while (s[i] >= '0' && s[i] <= '9') i++;
      return i > st ? parseInt(s.slice(st, i), 10) : null;
    };
    const fail = (m, at) => { throw new DiceError(m, at === undefined ? i : at); };
    const die = sides => 1 + Math.floor(rng() * sides);

    function term() {
      ws();
      const st = i, n = num();
      ws();
      if (s[i] !== 'd') {
        if (n === null) fail(i >= s.length ? 'Expected a number or dice' : 'Unexpected "' + s[i] + '"');
        return { kind: 'const', text: String(n), subtotal: n, dice: [] };
      }
      i++;
      let sides;
      if (s[i] === '%') { i++; sides = 100; }
      else { sides = num(); if (sides === null) fail('Expected a die size after "d"'); }
      const count = n === null ? 1 : n;
      if (count < 1 || count > MAX_DICE) fail('Dice count must be 1–' + MAX_DICE, st);
      if (sides < 2 || sides > MAX_SIDES) fail('Die size must be 2–' + MAX_SIDES, st);

      let explode = false, reroll = null, keep = null, cmp = null;
      for (;;) {
        ws();
        const two = s.substr(i, 2);
        if (s[i] === '!') { explode = true; i++; }
        else if (two === 'kh' || two === 'kl' || two === 'dh' || two === 'dl' || s[i] === 'k') {
          const at = i, mode = s[i] === 'k' && two !== 'kh' && two !== 'kl' ? 'kh' : two;
          i += (two === mode ? 2 : 1);
          const k = num();
          if (k === null) fail('Expected a count after "' + mode + '"');
          if (k < 1 && mode[0] === 'k') fail('Keep count must be at least 1', at);
          keep = { mode, k };
        }
        else if (s[i] === 'r') { i++; const k = num(); reroll = k === null ? 1 : k; }
        else if (s[i] === '>' || s[i] === '<') {
          const op = s[i]; i++;
          let eq = false; if (s[i] === '=') { eq = true; i++; }
          const k = num();
          if (k === null) fail('Expected a target number after "' + op + '"');
          cmp = { op, eq, k };
        }
        else break;
      }

      const dice = [];
      for (let c = 0; c < count; c++) {
        let v = die(sides), rr = false;
        if (reroll !== null && v <= reroll) { v = die(sides); rr = true; }
        dice.push({ sides, value: v, exploded: false, rerolled: rr, kept: true });
        let depth = 0, last = v;
        while (explode && last === sides && depth < MAX_EXPLODE) {
          last = die(sides); depth++;
          dice.push({ sides, value: last, exploded: true, rerolled: false, kept: true });
        }
      }
      if (keep) {
        const idx = dice.map((d, j) => j).sort((a, b) => dice[b].value - dice[a].value); // high → low
        const k = Math.min(keep.k, dice.length), n2 = dice.length;
        const kept = keep.mode === 'kh' ? idx.slice(0, k)
          : keep.mode === 'kl' ? idx.slice(n2 - k)
          : keep.mode === 'dh' ? idx.slice(k)
          : idx.slice(0, n2 - k);
        const set = new Set(kept);
        dice.forEach((d, j) => { d.kept = set.has(j); });
      }
      let subtotal = 0;
      for (const d of dice) {
        if (!d.kept) continue;
        if (cmp) {
          d.success = cmp.op === '>' ? (cmp.eq ? d.value >= cmp.k : d.value > cmp.k)
                                     : (cmp.eq ? d.value <= cmp.k : d.value < cmp.k);
          if (d.success) subtotal++;
        } else subtotal += d.value;
      }
      return { kind: 'dice', text: s.slice(st, i).replace(/\s+/g, ''), subtotal, dice, successMode: !!cmp };
    }

    ws();
    if (i >= s.length) fail('Enter a dice expression', 0);
    const groups = [];
    let total = 0, sign = 1;
    if (s[i] === '-') { sign = -1; i++; } else if (s[i] === '+') i++;
    for (;;) {
      const t = term();
      t.sign = sign; total += sign * t.subtotal; groups.push(t);
      ws();
      if (i >= s.length) break;
      if (s[i] === '+') sign = 1; else if (s[i] === '-') sign = -1;
      else fail('Unexpected "' + s[i] + '"');
      i++;
    }
    const expression = groups.map((t, j) => (t.sign < 0 ? '-' : j ? '+' : '') + t.text).join('');
    return { expression, groups, total };
  }

  g.Dice = { roll, DiceError, MAX_DICE, MAX_SIDES };
})(typeof window !== 'undefined' ? window : globalThis);
