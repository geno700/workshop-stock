// Shared constants, formatters and small hooks.
import { useState, useEffect } from './lib.js';
import { config } from '../config.js';

export const KINDS = {
  raw: { label: 'Raw stock', fields: [['grade', 'Material / grade'], ['dimensions', 'Dimensions']] },
  component: { label: 'Component', fields: [['part_no', 'Part number'], ['spec', 'Specs']] },
  consumable: { label: 'Consumable', fields: [['spec', 'Type / spec']] },
  tool: { label: 'Tool', fields: [['serial', 'Serial / asset no.'], ['condition', 'Condition']] },
};

export const UNITS = ['pcs', 'm', 'mm', 'kg', 'g', 'm²', 'L', 'sheet', 'roll', 'box', 'set'];

export const MOVE_LABELS = { in: 'Added', out: 'Taken', adjust: 'Recount', checkout: 'Borrowed', return: 'Returned' };

export const ROLES = {
  pending: 'Waiting for approval',
  viewer: 'Viewer (read only)',
  member: 'Member (add and take stock)',
  admin: 'Admin (everything)',
};

export const fmtNum = (n) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const fmtMoney = (n) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  (config.currency ? ' ' + config.currency : '');

export function fmtDate(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

// Tools are borrowed and returned, so a low count there is not a reorder signal.
export const isLow = (item) =>
  item.kind !== 'tool' && Number(item.min_quantity) > 0 && Number(item.quantity) <= Number(item.min_quantity);

// Address used inside QR codes, so labels printed from this PC still point at the live app.
export const appBase = () => config.appUrl || location.origin + location.pathname;

// Works out which borrowed tools are still out, from 'checkout' and 'return' movements.
// A return is matched to the same person's oldest loan first, then to anyone's oldest loan.
export function openLoans(moves) {
  const loans = [];
  const sorted = [...moves].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const m of sorted) {
    if (m.type === 'checkout') {
      loans.push({
        item_id: m.item_id, item_name: m.item_name, unit: m.unit, user_id: m.user_id, user_name: m.user_name,
        quantity: Number(m.quantity), since: m.created_at, reason: m.reason,
      });
    } else if (m.type === 'return') {
      let left = Number(m.quantity);
      const mine = loans.filter((l) => l.item_id === m.item_id && l.user_id === m.user_id);
      const others = loans.filter((l) => l.item_id === m.item_id && l.user_id !== m.user_id);
      for (const l of [...mine, ...others]) {
        const used = Math.min(l.quantity, left);
        l.quantity = Math.round((l.quantity - used) * 1e6) / 1e6;
        left -= used;
        if (left <= 0) break;
      }
    }
  }
  return loans.filter((l) => l.quantity > 0);
}

export const go = (path) => {
  location.hash = path;
};

// action: optional { label, run } shown as a button inside the toast.
export function toast(message, bad = false, action = null) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = message;
  if (action) {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.onclick = () => {
      el.remove();
      action.run();
    };
    el.append(button);
  }
  host.append(el);
  setTimeout(() => el.remove(), action ? 10000 : bad ? 5000 : 2500);
}

// Cost of the material in one movement, at the item's current unit cost.
export const moveCost = (m) => Math.abs(Number(m.delta)) * Number(m.unit_cost ?? 0);

// ---------- CSV ----------

export function toCSV(headers, rows) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // Stop spreadsheet apps from running text cells as formulas.
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = "'" + s;
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

// Reads comma- or semicolon-separated text into rows of cells. Handles quoted cells.
export function parseCSV(input) {
  const text = input.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const delim = first.split(';').length > first.split(',').length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const today = () => new Date().toISOString().slice(0, 10);

// Runs an async loader and tracks { data, error, loading }; reload() runs it again.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (error) => live && setState({ error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  // Refresh when stock is changed from somewhere else on the page (the voice box).
  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    addEventListener('stock-changed', again);
    return () => removeEventListener('stock-changed', again);
  }, []);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
