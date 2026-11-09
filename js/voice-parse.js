// Turns a spoken or typed sentence into a draft action. Pure functions, no AI: verb keywords,
// a quantity, and fuzzy matching against the workshop's own items and projects.

const VERBS = [
  ['new', ['add a new item', 'add new item', 'create a new item', 'create new item', 'create item', 'new item', 'add item']],
  ['return', ['bring back', 'brought back', 'give back', 'check in', 'returned', 'returning', 'return']],
  ['checkout', ['check out', 'sign out', 'borrowed', 'borrowing', 'borrow', 'lend']],
  ['adjust', ['recount', 'counted', 'count', 'adjust', 'we now have', 'we have', 'there are', 'there is', 'set']],
  ['out', ['take out', 'took out', 'taking', 'take', 'took', 'used', 'using', 'use', 'removed', 'remove', 'withdraw', 'consumed', 'consume', 'grab', 'pull']],
  ['in', ['put in', 'put back', 'added', 'adding', 'add', 'received', 'receive', 'restocked', 'restock', 'bought', 'buy', 'delivered']],
  ['find', ["where's", 'where is', 'where are', 'where', 'how many', 'how much', 'find', 'locate', 'show me', 'show', 'open', 'search for', 'search', 'look up', 'do we have', 'check']],
];

const FILLER = /^(?:please|hey|ok|okay|can you|could you|i want to|i need to|i would like to|i'd like to|i|let's|lets)\s+/;

const UNIT_WORDS = {
  pcs: 'pcs', pc: 'pcs', piece: 'pcs', pieces: 'pcs', unit: 'pcs', units: 'pcs',
  m: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  mm: 'mm', millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gram: 'g', grams: 'g',
  l: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L',
  sheet: 'sheet', sheets: 'sheet', roll: 'roll', rolls: 'roll', box: 'box', boxes: 'box', set: 'set', sets: 'set',
};

const SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const STOP = new Set(['the', 'a', 'an', 'of', 'some', 'my', 'our', 'please', 'left', 'stock', 'in', 'we', 'have', 'do', 'are', 'is', 'there']);

const clean = (text) =>
  text.toLowerCase().replace(/×/g, 'x').replace(/[?!"]/g, ' ').replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ').trim();

// Reads a number starting at words[i]: digits ("5", "2.5") or words ("twenty five", "one point five", "half a").
function readNumber(words, i) {
  const w = words[i];
  if (w === undefined) return null;
  if (/^\d+(\.\d+)?$/.test(w)) return { value: Number(w), next: i + 1 };
  if (w === 'half') return { value: 0.5, next: words[i + 1] === 'a' || words[i + 1] === 'an' ? i + 2 : i + 1 };
  if (w === 'dozen') return { value: 12, next: i + 1 };
  if ((w === 'a' || w === 'an') && (words[i + 1] === 'dozen' || words[i + 1] === 'couple')) {
    return { value: words[i + 1] === 'dozen' ? 12 : 2, next: i + 2 };
  }
  let value = 0;
  let j = i;
  let seen = false;
  while (j < words.length) {
    const t = words[j];
    if (t in SMALL) value += SMALL[t];
    else if (t in TENS) value += TENS[t];
    else if (t === 'hundred' && seen) value = (value || 1) * 100;
    else if (t === 'and' && seen && (words[j + 1] in SMALL || words[j + 1] in TENS)) {
      j++;
      continue;
    } else break;
    seen = true;
    j++;
  }
  if (!seen) return null;
  if (words[j] === 'point' && words[j + 1] in SMALL) {
    let frac = '';
    j++;
    while (words[j] in SMALL && SMALL[words[j]] < 10) frac += SMALL[words[j++]];
    value = Number(value + '.' + frac);
  } else if (words[j] === 'and' && words[j + 1] === 'a' && words[j + 2] === 'half') {
    value += 0.5;
    j += 3;
  }
  return { value, next: j };
}

const tokens = (text) =>
  clean(String(text ?? ''))
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));

function nearly(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 4) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else {
        i++;
        j++;
      }
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const tokenScore = (q, t) => {
  if (q === t) return 1;
  if (q.length >= 3 && t.startsWith(q)) return 0.8;
  if (t.length >= 3 && q.startsWith(t)) return 0.7;
  return nearly(q, t) ? 0.7 : 0;
};

// Scores each candidate (0..1) by how well the spoken words match its text.
export function rank(query, list, textOf, nameOf) {
  const q = tokens(query).filter((t) => !STOP.has(t));
  if (!q.length) return [];
  return list
    .map((entry) => {
      const all = tokens(textOf(entry));
      const name = tokens(nameOf(entry));
      const hit = q.reduce((sum, qt) => sum + Math.max(0, ...all.map((t) => tokenScore(qt, t))), 0) / q.length;
      const covered = name.length ? name.filter((t) => q.some((qt) => tokenScore(qt, t) > 0)).length / name.length : 0;
      return { entry, score: 0.75 * hit + 0.25 * covered };
    })
    .filter((r) => r.score >= 0.35)
    .sort((a, b) => b.score - a.score);
}

const itemText = (i) => [i.name, i.category, ...Object.values(i.specs ?? {})].join(' ');
const rankItems = (query, items) => rank(query, items, itemText, (i) => i.name).slice(0, 5);

function parseNew(rest, locations) {
  let text = rest.replace(/^(?:called|named|name)\s+/, '');
  const draft = { name: '', quantity: 0, unit: 'pcs', location_name: '' };

  const place = text.match(/(?:,|\s)\s*(?:in|at|on|location)\s+(?:the\s+)?([a-z0-9 ]+)$/);
  if (place) {
    draft.location_name = place[1].trim();
    text = text.slice(0, place.index);
  } else {
    const last = text.split(',').pop().trim();
    const known = rank(last, locations, (l) => l.name, (l) => l.name)[0];
    if (text.includes(',') && known && known.score >= 0.8) {
      draft.location_name = known.entry.name;
      text = text.slice(0, text.lastIndexOf(','));
    }
  }
  const known = rank(draft.location_name, locations, (l) => l.name, (l) => l.name)[0];
  if (known && known.score >= 0.8) draft.location_name = known.entry.name;
  else if (draft.location_name) draft.location_name = draft.location_name.replace(/\b[a-z]/g, (c) => c.toUpperCase());

  // The last "number + unit" is the quantity; earlier ones (like "3 mm") stay in the name.
  const unitAlt = Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|');
  const amounts = [...text.matchAll(new RegExp(`(?:,\\s*|\\s+quantity\\s+|\\s+)(\\d+(?:\\.\\d+)?)\\s*(${unitAlt})\\b`, 'g'))];
  const amount = amounts.pop();
  const atEnd = amount && amount.index + amount[0].length >= text.length && UNIT_WORDS[amount[2]] !== 'mm';
  if (amount && (amounts.length > 0 || /,|quantity/.test(amount[0]) || atEnd)) {
    draft.quantity = Number(amount[1]);
    draft.unit = UNIT_WORDS[amount[2]];
    text = text.slice(0, amount.index) + text.slice(amount.index + amount[0].length);
  }
  draft.name = text.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ').trim();
  draft.name = draft.name.charAt(0).toUpperCase() + draft.name.slice(1);
  return draft;
}

export function parseCommand(input, { items = [], projects = [], locations = [] } = {}) {
  let text = clean(input ?? '');
  while (FILLER.test(text)) text = text.replace(FILLER, '');
  if (!text) return { intent: 'none' };

  let type = null;
  let rest = text;
  outer: for (const [kind, phrases] of VERBS) {
    for (const p of phrases) {
      if (text === p || text.startsWith(p + ' ')) {
        type = kind;
        rest = text.slice(p.length).trim();
        break outer;
      }
    }
  }

  if (type === 'new') return { intent: 'new', draft: parseNew(rest, locations) };
  if (!type || type === 'find') {
    const query = rest.replace(/\b(?:do we have|are there|is there|left|in stock)\b/g, ' ');
    return { intent: 'find', query: query.trim(), candidates: rankItems(query, items) };
  }

  // "... for <project or reason>"
  let project = null;
  let reason = '';
  const cut = rest.lastIndexOf(' for ');
  let head = rest;
  if (cut > 0) {
    const tail = rest.slice(cut + 5).replace(/^(?:the|project|job)\s+/g, '').replace(/\s+(?:project|job)$/, '');
    const whole = rankItems(rest, items)[0]?.score ?? 0;
    const front = rankItems(rest.slice(0, cut), items)[0]?.score ?? 0;
    if (whole <= front + 0.1) {
      head = rest.slice(0, cut);
      const match = rank(tail, projects.filter((p) => p.status === 'active'), (p) => p.name, (p) => p.name)[0];
      if (match && match.score >= 0.6) project = match.entry;
      else reason = tail.charAt(0).toUpperCase() + tail.slice(1);
    }
  }

  let words = head.replace(/,/g, ' ').split(' ').filter(Boolean);
  let quantity = null;
  let withQty = null;

  // "set X to 12", "X is 12"
  if (type === 'adjust') {
    const at = Math.max(words.lastIndexOf('to'), words.lastIndexOf('is'), words.lastIndexOf('at'), words.lastIndexOf('are'));
    const n = at > 0 ? readNumber(words, at + 1) : null;
    if (n && n.next >= words.length - 1) {
      quantity = n.value;
      words = words.slice(0, at);
    }
  }
  if (quantity === null) {
    const n = readNumber(words, 0);
    if (n) {
      let next = n.next;
      if (words[next] in UNIT_WORDS && next < words.length - 1) next++;
      if (words[next] === 'of') next++;
      withQty = { value: n.value, phrase: words.slice(next).join(' ') };
    }
  }

  const plain = rankItems(words.join(' '), items);
  let candidates = plain;
  if (withQty) {
    const split = rankItems(withQty.phrase, items);
    const top = split[0];
    // The leading number may be part of the item's name ("608 bearing", "125 mm disc").
    const numberIsName =
      plain[0] &&
      (!top ||
        (plain[0].score >= top.score + 0.15 ||
          (plain[0].score >= top.score - 0.05 && (type === 'out' || type === 'checkout') && withQty.value > Number(top.entry.quantity))));
    if (!numberIsName) {
      quantity = withQty.value;
      candidates = split;
    }
  }

  const qtyAssumed = quantity === null && type !== 'adjust';
  if (qtyAssumed) quantity = 1;

  const best = candidates[0]?.entry;
  if (best?.kind === 'tool' && type === 'out') type = 'checkout';
  if (best && best.kind !== 'tool' && type === 'checkout') type = 'out';
  if (type !== 'out') project = null;

  return { intent: 'move', type, quantity, qtyAssumed, candidates, project, reason };
}
