/* Dungeon Ledger session tracker — local grammar parser + the single apply() path.
   Closed command vocabulary (mirrors TrackingCommand in the design spec):
   damage, heal, applyCondition, removeCondition, setInitiative, nextTurn, setRound,
   addCombatant, removeCombatant, inventoryChange, note, unresolved.
   parse() never mutates state; every state change goes through apply(). */
(function (g) {
  'use strict';
  const CONDITIONS = ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated',
    'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned',
    'unconscious', 'exhausted', 'concentrating', 'hidden', 'burning', 'slowed', 'hasted',
    'blessed', 'cursed', 'dead'];
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20 };

  const norm = s => String(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]/g, '');
  const title = s => s.trim().replace(/\b[a-z]/g, c => c.toUpperCase());
  const order = s => s.combatants.slice().sort((a, b) => b.initiative - a.initiative);

  function resolve(name, session) {
    const n = norm(name);
    if (!n) return null;
    const cs = session.combatants;
    for (const test of [c => norm(c.name) === n, c => norm(c.name).startsWith(n), c => norm(c.name).includes(n)]) {
      const m = cs.filter(test);
      if (m.length === 1) return m[0];
      if (m.length > 1) return null; // ambiguous — never guess
    }
    return null;
  }

  function parseClause(c, session) {
    let m;
    const need = (name, cmd) => {
      const e = resolve(name, session);
      return e ? Object.assign(cmd, { target: { id: e.id, name: e.name } })
        : { type: 'unresolved', utterance: c, reason: 'No single combatant matches “' + name.trim() + '”' };
    };
    const isCond = w => CONDITIONS.includes(w.toLowerCase());

    if (/^(next( turn)?|end( of)? turn|pass)$/i.test(c)) return { type: 'nextTurn' };
    if ((m = c.match(/^(?:top of |start of |set )?round (\d+)$/i))) return { type: 'setRound', round: +m[1] };
    if ((m = c.match(/^note[:\s]+(.+)$/i))) return { type: 'note', text: m[1] };

    if ((m = c.match(/^add (condition )?(\w+) to (.+)$/i)) && (m[1] || isCond(m[2])))
      return need(m[3], { type: 'applyCondition', condition: m[2].toLowerCase(), rounds: null });
    if ((m = c.match(/^add (.+?)((?:\s+(?:(?:hp|init|initiative)\s+\d+|ally|enemy))*)$/i))) {
      const o = m[2] || '', hp = o.match(/hp\s+(\d+)/i), ini = o.match(/init(?:iative)?\s+(\d+)/i);
      return { type: 'addCombatant', name: title(m[1]), hp: hp ? +hp[1] : null,
        initiative: ini ? +ini[1] : null, isAlly: /\bally\b/i.test(o) };
    }
    if ((m = c.match(/^(?:remove|clear) (?:condition )?(\w+) from (.+)$/i)))
      return need(m[2], { type: 'removeCondition', condition: m[1].toLowerCase() });
    if ((m = c.match(/^(.+?) (?:is )?no longer (\w+)$/i)))
      return need(m[1], { type: 'removeCondition', condition: m[2].toLowerCase() });
    if ((m = c.match(/^(?:remove|kill|delete) (.+)$/i))) return need(m[1], { type: 'removeCombatant' });

    const dtype = w => (w && !/^(damage|hp|points?)$/i.test(w) ? w.toLowerCase() : null);
    if ((m = c.match(/^(.+?) (?:takes?|took|suffers?) (\d+)(?: points?(?: of)?)?(?: (\w+))?(?: damage| hp)?$/i)))
      return need(m[1], { type: 'damage', amount: +m[2], dtype: dtype(m[3]) });
    if ((m = c.match(/^(\d+)(?: (\w+))? damage to (.+)$/i)))
      return need(m[3], { type: 'damage', amount: +m[1], dtype: dtype(m[2]) });
    if ((m = c.match(/^(?:hits?|damages?) (.+?) (?:for|by) (\d+)(?: (\w+))?(?: damage)?$/i)))
      return need(m[1], { type: 'damage', amount: +m[2], dtype: dtype(m[3]) });
    if ((m = c.match(/^(.+?) (?:heals?|healed|regains?|recovers?)(?: for)? (\d+)(?: hp| hit points)?$/i)))
      return need(m[1], { type: 'heal', amount: +m[2] });
    if ((m = c.match(/^heal (.+?) (?:for |by )?(\d+)(?: hp)?$/i)))
      return need(m[1], { type: 'heal', amount: +m[2] });
    if ((m = c.match(/^(.+?)\s*-\s*(\d+)(?: hp)?$/i))) return need(m[1], { type: 'damage', amount: +m[2], dtype: null });
    if ((m = c.match(/^(.+?)\s*\+\s*(\d+)(?: hp)?$/i))) return need(m[1], { type: 'heal', amount: +m[2] });
    if ((m = c.match(/^(.+?) (?:init|initiative)(?: is| to)? (\d+)$/i)))
      return need(m[1], { type: 'setInitiative', value: +m[2] });
    if ((m = c.match(/^(.+?) (?:is now|is|becomes|gets|falls|goes) (\w+)(?: for (\d+) rounds?)?$/i)) && isCond(m[2]))
      return need(m[1], { type: 'applyCondition', condition: m[2].toLowerCase(), rounds: m[3] ? +m[3] : null });
    if ((m = c.match(/^(.+?) (gains?|gets?|finds?|picks up|uses?|drinks?|drops?|loses?|spends?) (?:(\d+|an?|the) )?(.+)$/i))) {
      const qty = /^\d+$/.test(m[3] || '') ? +m[3] : 1;
      const gain = /^(gain|get|find|pick)/i.test(m[2]);
      return need(m[1], { type: 'inventoryChange', item: m[4].trim(), delta: gain ? qty : -qty });
    }
    return { type: 'unresolved', utterance: c, reason: 'Not understood' };
  }

  function parse(utterance, session) {
    const text = String(utterance).replace(/\b[a-z]+\b/gi, w => (WORDS[w.toLowerCase()] !== undefined ? WORDS[w.toLowerCase()] : w));
    return text.split(/\s*(?:[,;.]|\band then\b|\bthen\b|\band\b)\s*/i)
      .map(c => c.trim()).filter(Boolean).map(c => parseClause(c, session));
  }

  function describe(cmd) {
    const t = cmd.target ? cmd.target.name : '';
    switch (cmd.type) {
      case 'damage': return t + ' −' + cmd.amount + ' HP' + (cmd.dtype ? ' (' + cmd.dtype + ')' : '');
      case 'heal': return t + ' +' + cmd.amount + ' HP';
      case 'applyCondition': return t + ': ' + cmd.condition + (cmd.rounds ? ' (' + cmd.rounds + ' rds)' : '');
      case 'removeCondition': return t + ': remove ' + cmd.condition;
      case 'setInitiative': return t + ' initiative ' + cmd.value;
      case 'nextTurn': return 'Next turn';
      case 'setRound': return 'Round ' + cmd.round;
      case 'addCombatant': return 'Add ' + cmd.name + (cmd.hp != null ? ' · ' + cmd.hp + ' HP' : '') +
        (cmd.initiative != null ? ' · init ' + cmd.initiative : '') + (cmd.isAlly ? ' · ally' : '');
      case 'removeCombatant': return 'Remove ' + t;
      case 'inventoryChange': return t + ' ' + (cmd.delta > 0 ? '+' : '') + cmd.delta + ' ' + cmd.item;
      case 'note': return 'Note: ' + cmd.text;
      default: return '“' + cmd.utterance + '” — ' + cmd.reason;
    }
  }

  function tickConditions(s) {
    for (const c of s.combatants) {
      c.conditions = c.conditions.filter(k => k.rounds == null || --k.rounds > 0);
    }
  }

  /* Applies a confirmed command to the session (mutates) and returns the log line. */
  function apply(cmd, s, characters, newId) {
    const c = cmd.target ? s.combatants.find(x => x.id === cmd.target.id) : null;
    if (cmd.target && !c) return cmd.target.name + ' is no longer in the encounter';
    switch (cmd.type) {
      case 'damage':
        c.hp = Math.max(0, c.hp - cmd.amount);
        return c.name + ' takes ' + cmd.amount + (cmd.dtype ? ' ' + cmd.dtype : '') + ' damage (' + c.hp + '/' + c.maxHp + ')' + (c.hp === 0 ? ' — down!' : '');
      case 'heal':
        c.hp = c.maxHp ? Math.min(c.maxHp, c.hp + cmd.amount) : c.hp + cmd.amount;
        return c.name + ' heals ' + cmd.amount + ' (' + c.hp + '/' + c.maxHp + ')';
      case 'applyCondition':
        c.conditions = c.conditions.filter(k => k.name !== cmd.condition);
        c.conditions.push({ name: cmd.condition, rounds: cmd.rounds || null });
        return c.name + ' is ' + cmd.condition + (cmd.rounds ? ' for ' + cmd.rounds + ' rounds' : '');
      case 'removeCondition':
        c.conditions = c.conditions.filter(k => k.name !== cmd.condition);
        return c.name + ' is no longer ' + cmd.condition;
      case 'setInitiative':
        c.initiative = cmd.value;
        return c.name + ' initiative set to ' + cmd.value;
      case 'nextTurn': {
        const o = order(s);
        if (!o.length) return 'No combatants yet';
        const idx = o.findIndex(x => x.id === s.activeId);
        let next = idx + 1;
        if (idx !== -1 && next >= o.length) { next = 0; s.round++; tickConditions(s); }
        if (idx === -1) next = 0;
        s.activeId = o[next].id;
        return 'Round ' + s.round + ' — ' + o[next].name + '’s turn';
      }
      case 'setRound':
        s.round = cmd.round;
        return 'Round set to ' + cmd.round;
      case 'addCombatant': {
        const hp = cmd.hp != null ? cmd.hp : 0;
        const ini = cmd.initiative != null ? cmd.initiative : 1 + Math.floor(Math.random() * 20);
        s.combatants.push({ id: newId(), name: cmd.name, isAlly: !!cmd.isAlly, initiative: ini,
          hp, maxHp: hp, conditions: [], characterId: cmd.characterId || null });
        return cmd.name + ' joins (init ' + ini + (cmd.initiative == null ? ', rolled' : '') + ')';
      }
      case 'removeCombatant':
        if (s.activeId === c.id) s.activeId = null;
        s.combatants = s.combatants.filter(x => x.id !== c.id);
        return c.name + ' removed';
      case 'inventoryChange': {
        const ch = c.characterId && characters.find(x => x.id === c.characterId);
        const line = c.name + ' ' + (cmd.delta > 0 ? 'gains ' : 'uses ') + Math.abs(cmd.delta) + ' × ' + cmd.item;
        if (!ch) return line + ' (not tracked — no linked character)';
        const key = norm(cmd.item);
        let it = ch.inventory.find(x => norm(x.name) === key) || ch.inventory.find(x => norm(x.name).includes(key) || key.includes(norm(x.name)));
        if (!it) {
          if (cmd.delta < 0) return line + ' (not in inventory)';
          it = { name: title(cmd.item), qty: 0 }; ch.inventory.push(it);
        }
        it.qty += cmd.delta;
        if (it.qty <= 0) ch.inventory = ch.inventory.filter(x => x !== it);
        return line + ' (' + Math.max(0, it.qty) + ' left)';
      }
      case 'note': return cmd.text;
      default: return 'Ignored: ' + (cmd.utterance || cmd.type);
    }
  }

  g.Tracker = { parse, describe, apply, order, resolve, CONDITIONS };
})(typeof window !== 'undefined' ? window : globalThis);
