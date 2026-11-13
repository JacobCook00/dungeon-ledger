/* Dungeon Ledger — UI + state. All data lives on this device (localStorage). */
(function () {
  'use strict';
  const KEY = 'dungeonledger.v1';
  const STATS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const time = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const mod = v => Math.floor(((+v || 10) - 10) / 2);
  const signed = n => (n >= 0 ? '+' : '') + n;

  const blank = () => ({ characters: [], sessions: [], rolls: [], activeSessionId: null, tab: 'dice' });
  let S = load();
  function load() {
    try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return blank(); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage full/blocked */ } }
  const active = () => S.sessions.find(s => s.id === S.activeSessionId && !s.endedAt) || null;

  // transient UI state
  let expr = '', lastRoll = null, diceErr = null, pending = [], undo = [], sheetId = null;

  // ───────────── dice
  function doRoll(expression, label) {
    try {
      const r = Dice.roll(expression);
      lastRoll = Object.assign({ label: label || null }, r); diceErr = null;
      S.rolls.unshift({ id: uid(), expression: r.expression, total: r.total, label: label || null, at: Date.now(),
        results: [].concat.apply([], r.groups.map(g => g.dice.filter(d => d.kept).map(d => d.value))) });
      if (S.rolls.length > 200) S.rolls.length = 200;
      const s = active();
      if (s) s.log.push({ at: Date.now(), round: s.round, summary: '🎲 ' + (label ? label + ': ' : '') + r.expression + ' = ' + r.total });
      save();
      if (navigator.vibrate) navigator.vibrate(15);
    } catch (e) {
      if (!(e instanceof Dice.DiceError)) throw e;
      diceErr = e; lastRoll = null;
    }
    render();
  }
  function groupHtml(g, j) {
    let h = (j || g.sign < 0) ? '<span class="op">' + (g.sign < 0 ? '−' : '+') + '</span>' : '';
    if (g.kind === 'const') return h + '<span class="op">' + g.text + '</span>';
    return h + g.dice.map(d => '<span class="die' + (!d.kept ? ' drop' : d.success ? ' hit' : d.value === d.sides ? ' max' : d.value === 1 ? ' min' : '') +
      (d.exploded ? ' boom' : '') + '">' + d.value + '</span>').join('');
  }
  function viewDice() {
    let o = '<section class="result" aria-live="polite">';
    if (diceErr) o += '<div class="err"><b>' + esc(diceErr.message) + '</b><pre>' + esc(expr) + '\n' + ' '.repeat(Math.max(0, diceErr.index)) + '^</pre></div>';
    else if (lastRoll) o += (lastRoll.label ? '<div class="lbl">' + esc(lastRoll.label) + '</div>' : '') +
      '<div class="total">' + lastRoll.total + '</div><div class="exprline">' + esc(lastRoll.expression) + '</div>' +
      '<div class="groups">' + lastRoll.groups.map(groupHtml).join('') + '</div>';
    else o += '<div class="hint">Tap dice to build a roll, or type one like <code>4d6kh3+2</code></div>';
    o += '</section>';
    o += '<form class="row" data-submit="roll"><input id="expr" value="' + esc(expr) + '" placeholder="2d20kh1+5" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-label="Dice expression"><button class="btn primary">Roll</button></form>';
    o += '<div class="grid dice">' + [4, 6, 8, 10, 12, 20, 100].map(n => '<button data-a="die" data-id="' + n + '">d' + n + '</button>').join('') + '<button data-a="clear" aria-label="Clear">⌫</button></div>';
    o += '<div class="grid mods"><button data-a="mod" data-id="-1">−1</button><button data-a="mod" data-id="1">+1</button><button data-a="quick" data-id="2d20kh1">Adv</button><button data-a="quick" data-id="2d20kl1">Dis</button></div>';
    if (S.rolls.length) {
      o += '<h2>History</h2><div class="list">' + S.rolls.slice(0, 40).map(r =>
        '<button class="card hist" data-a="reroll" data-id="' + esc(r.expression) + '"><span>' + (r.label ? esc(r.label) + ' · ' : '') + '<code>' + esc(r.expression) + '</code><br><small>' +
        (r.results.length > 1 && r.results.length <= 12 ? '[' + r.results.join(', ') + '] · ' : '') + time(r.at) + '</small></span><b>' + r.total + '</b></button>').join('') +
        '</div><p><button class="btn small danger" data-a="clearRolls">Clear history</button></p>';
    }
    return o;
  }
  function addDie(n) {
    const m = expr.match(/(^|[+-])(\d*)d(\d+)$/);
    if (m && +m[3] === n) expr = expr.slice(0, expr.length - m[0].length) + m[1] + ((+m[2] || 1) + 1) + 'd' + n;
    else expr += (expr ? '+' : '') + '1d' + n;
  }
  function addMod(delta) {
    const m = expr.match(/([+-]\d+)$/);
    let n = delta, base = expr;
    if (m) { n += +m[1]; base = expr.slice(0, expr.length - m[1].length); }
    expr = base + (n ? (n > 0 && base ? '+' : n > 0 ? '' : '-') + Math.abs(n) : '');
  }

  // ───────────── session
  function run(cmd) {
    const s = active(); if (!s) return;
    undo.push(JSON.stringify({ s, c: S.characters })); if (undo.length > 30) undo.shift();
    const summary = Tracker.apply(cmd, s, S.characters, uid);
    s.log.push({ at: Date.now(), round: s.round, summary });
    save();
  }
  function hpBar(c) {
    if (!c.maxHp) return '';
    const p = Math.max(0, Math.min(100, Math.round(100 * c.hp / c.maxHp)));
    return '<div class="bar"><i class="' + (p > 50 ? '' : p > 25 ? 'mid' : 'low') + '" style="width:' + p + '%"></i></div>';
  }
  function logHtml(s, n) {
    const l = s.log.slice(-n).reverse();
    return l.length ? '<div class="log">' + l.map(e => '<div>' + esc(e.summary) + ' <small>· R' + e.round + ' ' + time(e.at) + '</small></div>').join('') + '</div>'
      : '<div class="empty">Nothing logged yet.</div>';
  }
  function viewSession() {
    const s = active();
    if (!s) {
      let o = '<div class="empty">No session running.<br>Start one to track initiative, HP and conditions.</div>' +
        '<button class="btn primary wide" data-a="newSession">Start a session</button>';
      if (S.sessions.length) o += '<h2>Past sessions</h2><div class="list">' + S.sessions.slice().reverse().map(x =>
        '<button class="card" data-a="openSession" data-id="' + x.id + '"><div class="top"><span class="name">' + esc(x.title) + '</span><span class="meta">' + day(x.startedAt) + '</span></div>' +
        '<div class="meta">' + x.log.length + ' log entries · round ' + x.round + '</div></button>').join('') + '</div>';
      return o;
    }
    const o = Tracker.order(s);
    let h = '<div class="sbar"><div class="round">Round ' + s.round + '<small>' + esc(s.title) + '</small></div>' +
      '<button class="btn primary" data-a="next">Next turn ▸</button></div><div class="list">';
    h += o.length ? o.map(c =>
      '<button class="card' + (c.id === s.activeId ? ' active' : '') + (c.isAlly ? ' ally' : '') + (c.maxHp && c.hp === 0 ? ' down' : '') + '" data-a="combatant" data-id="' + c.id + '">' +
      '<div class="top"><span class="name">' + esc(c.name) + '</span><span class="meta">init ' + c.initiative + (c.maxHp ? ' · ' + c.hp + '/' + c.maxHp + ' HP' : '') + '</span></div>' + hpBar(c) +
      (c.conditions.length ? '<div class="chips">' + c.conditions.map(k => '<span class="chip">' + esc(k.name) + (k.rounds ? ' ' + k.rounds : '') + '</span>').join('') + '</div>' : '') +
      '</button>').join('') : '<div class="empty">No combatants yet. Add some, or type<br><code>add goblin hp 7 init 12</code> below.</div>';
    h += '</div><div class="grid three"><button data-a="addCombatant">+ Add</button><button data-a="undo"' + (undo.length ? '' : ' disabled') + '>↶ Undo</button><button data-a="endSession">End</button></div>';
    h += '<h2>Session log</h2>' + logHtml(s, 60);
    return h;
  }
  function renderPending() {
    $('#pending').innerHTML = pending.map(p => p.cmd.type === 'unresolved'
      ? '<div class="pend bad"><span>' + esc(Tracker.describe(p.cmd)) + '</span><button class="no" data-a="pNo" data-id="' + p.id + '" aria-label="Dismiss">✕</button></div>'
      : '<div class="pend"><span>' + esc(Tracker.describe(p.cmd)) + '</span><button class="no" data-a="pNo" data-id="' + p.id + '" aria-label="Reject">✕</button><button class="ok" data-a="pOk" data-id="' + p.id + '" aria-label="Apply">✓</button></div>').join('') +
      (pending.filter(p => p.cmd.type !== 'unresolved').length > 1 ? '<button class="btn small" data-a="pAll">Apply all</button>' : '');
  }
  function submitCmd() {
    const s = active(), inp = $('#cmd'), text = inp.value.trim();
    if (!s || !text) return;
    pending = pending.concat(Tracker.parse(text, s).map(cmd => ({ id: uid(), cmd })));
    inp.value = '';
    renderPending();
  }

  // ───────────── characters
  function viewChars() {
    let o = S.characters.length ? '<div class="list">' + S.characters.map(c =>
      '<div class="card"><div class="top" data-a="editChar" data-id="' + c.id + '"><span class="name">' + esc(c.name) + '</span><span class="meta">' + esc(c.characterClass || '') + ' ' + (c.level || 1) + ' · ' + (c.maxHP || 0) + ' HP ›</span></div>' +
      '<div class="chips">' + STATS.map(k => '<button class="chip" data-a="statRoll" data-id="' + c.id + '|' + k + '">' + k + ' ' + signed(mod(c.stats[k])) + '</button>').join('') + '</div>' +
      (c.inventory.length ? '<div class="meta" style="margin-top:8px;white-space:normal">' + c.inventory.map(i => esc(i.name) + (i.qty !== 1 ? ' ×' + i.qty : '')).join(', ') + '</div>' : '') +
      '</div>').join('') + '</div>' : '<div class="empty">No characters yet.<br>Tap a stat on a character to roll a check.</div>';
    o += '<p><button class="btn primary wide" data-a="newChar">+ New character</button></p>';
    o += '<h2>Your data</h2><div class="grid two"><button data-a="export">Export backup</button><button data-a="import">Import backup</button></div>' +
      '<p class="meta" style="color:var(--dim);font-size:13px">Everything is stored on this device only. Export a backup before clearing browser data or switching phones.</p>';
    return o;
  }
  function charSheet(c) {
    sheetId = c ? c.id : null;
    c = c || { name: '', characterClass: '', level: 1, maxHP: 10, stats: {}, notes: '', inventory: [] };
    openSheet('<form class="sheet" data-submit="saveChar"><h3>' + (sheetId ? 'Edit character' : 'New character') + '</h3>' +
      '<label>Name</label><input name="name" value="' + esc(c.name) + '" required>' +
      '<div class="grid three"><div><label>Class</label><input name="cls" value="' + esc(c.characterClass) + '"></div>' +
      '<div><label>Level</label><input name="level" type="number" inputmode="numeric" min="1" value="' + (c.level || 1) + '"></div>' +
      '<div><label>Max HP</label><input name="maxHP" type="number" inputmode="numeric" min="0" value="' + (c.maxHP || 0) + '"></div></div>' +
      '<div class="grid three">' + STATS.map(k => '<div class="stat"><label>' + k + '</label><input name="' + k + '" type="number" inputmode="numeric" value="' + (c.stats[k] || 10) + '"></div>').join('') + '</div>' +
      '<label>Inventory — one item per line, e.g. “3x Healing Potion”</label><textarea name="inv">' + esc(c.inventory.map(i => (i.qty !== 1 ? i.qty + 'x ' : '') + i.name).join('\n')) + '</textarea>' +
      '<label>Notes</label><textarea name="notes">' + esc(c.notes) + '</textarea>' +
      '<div class="actions">' + (sheetId ? '<button type="button" class="btn danger" data-a="delChar">Delete</button>' : '') +
      '<button type="button" class="btn" data-a="close">Cancel</button><button class="btn primary">Save</button></div></form>');
  }
  function combatantSheet(id) {
    const s = active(), c = s && s.combatants.find(x => x.id === id);
    if (!c) return closeSheet();
    sheetId = id;
    const has = n => c.conditions.some(k => k.name === n);
    openSheet('<div class="sheet"><h3>' + esc(c.name) + '</h3><div class="meta" style="color:var(--dim)">' + (c.maxHp ? c.hp + ' / ' + c.maxHp + ' HP · ' : '') + 'initiative ' + c.initiative + '</div>' +
      '<label>Amount</label><div class="row"><input name="amt" type="number" inputmode="numeric" min="0" placeholder="0"><button class="btn danger" data-a="cDmg">Damage</button><button class="btn" data-a="cHeal">Heal</button></div>' +
      '<label>Initiative</label><div class="row"><input name="init" type="number" inputmode="numeric" value="' + c.initiative + '"><button class="btn" data-a="cInit">Set</button></div>' +
      '<label>Conditions</label><div class="chips">' + Tracker.CONDITIONS.map(n => '<button class="chip' + (has(n) ? ' on' : '') + '" data-a="cCond" data-id="' + n + '">' + n + '</button>').join('') + '</div>' +
      '<div class="actions"><button class="btn danger" data-a="cRemove">Remove</button><button class="btn primary" data-a="close">Done</button></div></div>');
  }
  function addSheet() {
    const s = active();
    const free = S.characters.filter(ch => !s.combatants.some(c => c.characterId === ch.id));
    openSheet('<form class="sheet" data-submit="addCombatant"><h3>Add combatant</h3>' +
      (free.length ? '<label>From your characters (initiative is rolled with DEX)</label><div class="chips">' + free.map(ch => '<button type="button" class="chip" data-a="addChar" data-id="' + ch.id + '">' + esc(ch.name) + '</button>').join('') + '</div>' : '') +
      '<label>Name</label><input name="name" required placeholder="Goblin 1">' +
      '<div class="grid two"><div><label>HP</label><input name="hp" type="number" inputmode="numeric" min="0" placeholder="—"></div>' +
      '<div><label>Initiative (blank = roll d20)</label><input name="init" type="number" inputmode="numeric" placeholder="roll"></div></div>' +
      '<label class="row" style="margin-top:14px"><input type="checkbox" name="ally" style="width:22px;min-height:22px;flex:none"> Ally / player character</label>' +
      '<div class="actions"><button type="button" class="btn" data-a="close">Done</button><button class="btn primary">Add</button></div></form>');
  }
  function sessionSheet(x) {
    sheetId = x.id;
    openSheet('<div class="sheet"><h3>' + esc(x.title) + '</h3><div class="meta" style="color:var(--dim);margin-bottom:12px">' + day(x.startedAt) + ' · ended at round ' + x.round + '</div>' + logHtml(x, 500) +
      '<div class="actions"><button class="btn danger" data-a="delSession">Delete</button><button class="btn" data-a="resume">Resume</button><button class="btn primary" data-a="close">Close</button></div></div>');
  }

  // ───────────── sheets + render
  function openSheet(html) { const d = $('#sheet'); d.innerHTML = html; if (!d.open) d.showModal(); }
  function closeSheet() { const d = $('#sheet'); if (d.open) d.close(); }
  const field = n => { const el = $('#sheet [name="' + n + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value.trim()) : ''; };

  function render() {
    document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.id === S.tab));
    $('#view').innerHTML = ({ dice: viewDice, session: viewSession, chars: viewChars })[S.tab]();
    const s = active();
    $('#cmdbar').hidden = !(S.tab === 'session' && s);
    $('#status').textContent = s ? 'Round ' + s.round : '';
    renderPending();
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) $('#mic').hidden = false;

  const A = {
    tab(id) { S.tab = id; save(); render(); },
    close() { closeSheet(); render(); },
    // dice
    die(id) { addDie(+id); render(); },
    mod(id) { addMod(+id); render(); },
    clear() { expr = ''; diceErr = null; render(); },
    quick(id) { doRoll(id, id === '2d20kh1' ? 'Advantage' : 'Disadvantage'); },
    reroll(id) { expr = id; doRoll(id); window.scrollTo(0, 0); $('#view').scrollTop = 0; },
    clearRolls() { if (confirm('Clear roll history?')) { S.rolls = []; save(); render(); } },
    statRoll(id) {
      const p = id.split('|'), c = S.characters.find(x => x.id === p[0]); if (!c) return;
      const m = mod(c.stats[p[1]]);
      S.tab = 'dice'; expr = '1d20' + (m ? signed(m) : '');
      doRoll(expr, c.name + ' ' + p[1]);
    },
    // session
    newSession() {
      const n = S.sessions.length + 1, title = prompt('Session title', 'Session ' + n);
      if (title === null) return;
      const s = { id: uid(), title: title.trim() || 'Session ' + n, startedAt: Date.now(), endedAt: null, round: 1, activeId: null, combatants: [], log: [] };
      S.sessions.push(s); S.activeSessionId = s.id; undo = []; pending = []; save(); render();
    },
    endSession() {
      const s = active(); if (!s || !confirm('End this session? You can resume it later.')) return;
      s.endedAt = Date.now(); S.activeSessionId = null; pending = []; undo = []; save(); render();
    },
    openSession(id) { const x = S.sessions.find(s => s.id === id); if (x) sessionSheet(x); },
    resume() {
      const cur = active(); if (cur) cur.endedAt = Date.now();
      const x = S.sessions.find(s => s.id === sheetId); if (!x) return;
      x.endedAt = null; S.activeSessionId = x.id; undo = []; pending = []; save(); closeSheet(); render();
    },
    delSession() {
      if (!confirm('Delete this session and its log? This cannot be undone.')) return;
      S.sessions = S.sessions.filter(s => s.id !== sheetId); save(); closeSheet(); render();
    },
    next() { run({ type: 'nextTurn' }); render(); },
    undo() {
      const snap = undo.pop(); if (!snap) return;
      const o = JSON.parse(snap), i = S.sessions.findIndex(s => s.id === o.s.id);
      if (i >= 0) S.sessions[i] = o.s;
      S.characters = o.c; save(); render();
    },
    addCombatant() { addSheet(); },
    addChar(id) {
      const ch = S.characters.find(x => x.id === id); if (!ch) return;
      run({ type: 'addCombatant', name: ch.name, hp: ch.maxHP || 0, isAlly: true, characterId: ch.id,
        initiative: Math.max(1, Dice.roll('1d20').total + mod(ch.stats.DEX)) });
      render(); addSheet();
    },
    combatant(id) { combatantSheet(id); },
    cDmg() { const n = +field('amt'); if (n > 0) { run({ type: 'damage', target: tgt(), amount: n, dtype: null }); closeSheet(); render(); } },
    cHeal() { const n = +field('amt'); if (n > 0) { run({ type: 'heal', target: tgt(), amount: n }); closeSheet(); render(); } },
    cInit() { const v = field('init'); if (v !== '') { run({ type: 'setInitiative', target: tgt(), value: +v }); render(); combatantSheet(sheetId); } },
    cCond(name) {
      const c = active().combatants.find(x => x.id === sheetId); if (!c) return;
      run({ type: c.conditions.some(k => k.name === name) ? 'removeCondition' : 'applyCondition', target: tgt(), condition: name, rounds: null });
      render(); combatantSheet(sheetId);
    },
    cRemove() { run({ type: 'removeCombatant', target: tgt() }); closeSheet(); render(); },
    pOk(id) { const p = pending.find(x => x.id === id); pending = pending.filter(x => x.id !== id); if (p) run(p.cmd); render(); },
    pNo(id) { pending = pending.filter(x => x.id !== id); renderPending(); },
    pAll() { pending.filter(p => p.cmd.type !== 'unresolved').forEach(p => run(p.cmd)); pending = pending.filter(p => p.cmd.type === 'unresolved'); render(); },
    mic() {
      const b = $('#mic'), r = new SR();
      r.lang = navigator.language || 'en-US';
      r.onresult = e => { $('#cmd').value = e.results[0][0].transcript; submitCmd(); };
      r.onend = r.onerror = () => { b.style.background = ''; };
      b.style.background = 'var(--red)';
      try { r.start(); } catch (e) { b.style.background = ''; }
    },
    // characters
    newChar() { charSheet(null); },
    editChar(id) { charSheet(S.characters.find(c => c.id === id)); },
    delChar() {
      if (!confirm('Delete this character? This cannot be undone.')) return;
      S.characters = S.characters.filter(c => c.id !== sheetId); save(); closeSheet(); render();
    },
    export() {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
      a.download = 'dungeon-ledger-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
    import() { $('#importFile').click(); }
  };
  function tgt() { const c = active().combatants.find(x => x.id === sheetId); return { id: sheetId, name: c ? c.name : '' }; }

  const F = {
    roll() { expr = $('#expr').value.trim(); doRoll(expr); },
    cmd() { submitCmd(); },
    saveChar() {
      const stats = {}; STATS.forEach(k => { stats[k] = +field(k) || 10; });
      const inventory = field('inv').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const m = l.match(/^(\d+)\s*[x×]?\s+(.+)$/i); return m ? { name: m[2], qty: +m[1] } : { name: l, qty: 1 };
      });
      const data = { name: field('name'), characterClass: field('cls'), level: +field('level') || 1, maxHP: +field('maxHP') || 0, stats, notes: field('notes'), inventory };
      const c = S.characters.find(x => x.id === sheetId);
      if (c) Object.assign(c, data); else S.characters.push(Object.assign({ id: uid(), createdAt: Date.now() }, data));
      save(); closeSheet(); render();
    },
    addCombatant() {
      const name = field('name'); if (!name) return;
      run({ type: 'addCombatant', name, hp: field('hp') === '' ? null : +field('hp'), initiative: field('init') === '' ? null : +field('init'), isAlly: field('ally') });
      render(); addSheet(); // stay open for adding several
    }
  };

  document.addEventListener('click', e => {
    if (e.target.id === 'sheet') { closeSheet(); render(); return; } // backdrop tap
    const el = e.target.closest('[data-a]');
    if (el && !el.disabled && A[el.dataset.a]) A[el.dataset.a](el.dataset.id);
  });
  document.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target.dataset.submit;
    if (F[f]) F[f]();
  });
  document.addEventListener('input', e => { if (e.target.id === 'expr') expr = e.target.value; });
  $('#importFile').addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!d || !Array.isArray(d.characters) || !Array.isArray(d.sessions)) throw new Error('bad');
        if (confirm('Replace everything on this device with the backup (' + d.characters.length + ' characters, ' + d.sessions.length + ' sessions)?')) {
          S = Object.assign(blank(), d); undo = []; pending = []; save(); render();
        }
      } catch (err) { alert('That file is not a Dungeon Ledger backup.'); }
      e.target.value = '';
    };
    rd.readAsText(file);
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
})();
