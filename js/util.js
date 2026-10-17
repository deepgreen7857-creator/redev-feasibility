'use strict';

// ㎡ ↔ 평 환산 (1평 = 3.305785㎡)
const PY = 3.305785;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));

function num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/[,\s]/g, ''));
  return isFinite(n) ? n : 0;
}

function fmt(n, d = 0) {
  if (n === null || n === undefined || !isFinite(n)) return '–';
  return n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// 내부 금액 단위는 '만원'. 화면 표시는 억원.
function fmtEok(manwon, d = 1) {
  return isFinite(manwon) ? fmt(manwon / 10000, d) + '억' : '–';
}

function fmtPct(v, d = 1) {
  return isFinite(v) ? fmt(v, d) + '%' : '–';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function getPath(o, p) {
  return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
}

function setPath(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  ks.reduce((a, k) => a[k], o)[last] = v;
}

// ---------- CSV ----------
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

function toCSV(rows) {
  // BOM을 붙여야 엑셀에서 한글이 깨지지 않음
  return '﻿' + rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

function download(name, text, type = 'text/plain;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

// 엑셀(.xlsx·.xls) 또는 CSV → 행 배열 (첫 시트)
function pickTableFile() {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.xlsx,.xls,.csv,text/csv';
    i.onchange = async () => {
      const f = i.files[0];
      if (!f) return resolve(null);
      const buf = await f.arrayBuffer();
      if (/\.xlsx?$/i.test(f.name) && window.XLSX) {
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        return resolve(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }).map(r => r.map(v => String(v ?? ''))));
      }
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('euc-kr').decode(buf); }
      resolve(parseCSV(text));
    };
    i.click();
  });
}

// 엑셀에서 저장한 CSV는 CP949(EUC-KR)인 경우가 많아 UTF-8 실패 시 EUC-KR로 다시 읽음
function pickTextFile(accept) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.onchange = async () => {
      const f = i.files[0];
      if (!f) return resolve(null);
      const buf = await f.arrayBuffer();
      try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(buf)); }
      catch { resolve(new TextDecoder('euc-kr').decode(buf)); }
    };
    i.click();
  });
}

// ---------- 편집 가능한 표 ----------
// cfg: { columns, rows(배열 참조), newRow(), onChange(), addLabel, footer(rows) => {key: text} }
// column: { key, label, type: 'text'|'number'|'select', options, computed(row,i), cls(row), width, rerender }
function makeTable(host, cfg) {
  function cellInput(col, row) {
    if (col.type === 'select') {
      const s = document.createElement('select');
      const opts = typeof col.options === 'function' ? col.options(row) : col.options;
      opts.forEach(o => s.add(new Option(o.label ?? o, o.value ?? o)));
      s.value = row[col.key] ?? '';
      s.onchange = () => { row[col.key] = s.value; changed(col); };
      return s;
    }
    const inp = document.createElement('input');
    inp.type = 'text';
    if (col.type === 'number') {
      inp.inputMode = 'decimal';
      inp.className = 'num';
      inp.value = row[col.key] ? fmt(row[col.key], col.dec ?? 0) : '';
      inp.oninput = () => { row[col.key] = num(inp.value); changed(col); };
      inp.onblur = () => { inp.value = row[col.key] ? fmt(row[col.key], col.dec ?? 0) : ''; };
      inp.onfocus = () => { inp.value = row[col.key] ? String(row[col.key]) : ''; inp.select(); };
    } else {
      inp.value = row[col.key] ?? '';
      inp.oninput = () => { row[col.key] = inp.value; changed(col); };
    }
    if (col.placeholder) inp.placeholder = col.placeholder;
    return inp;
  }

  function render() {
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    const t = document.createElement('table');
    t.className = 'grid';
    const head = cfg.columns.map(c => `<th${c.width ? ` style="min-width:${c.width}px"` : ''} class="${c.type === 'number' || c.computed ? 'num' : ''}">${c.label}</th>`).join('');
    t.innerHTML = `<thead><tr>${head}<th aria-label="삭제"></th></tr></thead>`;
    const tb = document.createElement('tbody');
    cfg.rows.forEach((row, i) => {
      const tr = document.createElement('tr');
      cfg.columns.forEach(col => {
        const td = document.createElement('td');
        if (col.computed) {
          td.dataset.c = col.key;
          td.className = 'num computed';
        } else td.append(cellInput(col, row));
        tr.append(td);
      });
      const del = document.createElement('td');
      const b = document.createElement('button');
      b.className = 'icon-btn';
      b.title = '행 삭제';
      b.textContent = '×';
      b.onclick = () => { cfg.rows.splice(i, 1); render(); cfg.onChange && cfg.onChange(); };
      del.append(b);
      tr.append(del);
      tb.append(tr);
    });
    if (!cfg.rows.length) {
      tb.innerHTML = `<tr><td class="empty" colspan="${cfg.columns.length + 1}">${cfg.emptyText || '아직 입력된 행이 없습니다.'}</td></tr>`;
    }
    t.append(tb);
    if (cfg.footer) {
      const tf = document.createElement('tfoot');
      tf.innerHTML = `<tr>${cfg.columns.map(c => `<td data-f="${c.key}" class="${c.type === 'number' || c.computed ? 'num' : ''}"></td>`).join('')}<td></td></tr>`;
      t.append(tf);
    }
    wrap.append(t);
    host.append(wrap);
    const add = document.createElement('button');
    add.className = 'btn small';
    add.textContent = '+ ' + (cfg.addLabel || '행 추가');
    add.onclick = () => { cfg.rows.push(cfg.newRow()); render(); cfg.onChange && cfg.onChange(); };
    host.append(add);
    refresh();
  }

  function refresh() {
    $$('tbody tr', host).forEach((tr, i) => {
      const row = cfg.rows[i];
      if (!row) return;
      $$('td[data-c]', tr).forEach(td => {
        const col = cfg.columns.find(c => c.key === td.dataset.c);
        td.textContent = col.computed(row, i);
        td.className = 'num computed ' + (col.cls ? col.cls(row, i) : '');
      });
    });
    if (cfg.footer) {
      const f = cfg.footer(cfg.rows);
      $$('tfoot td[data-f]', host).forEach(td => { td.textContent = f[td.dataset.f] ?? ''; });
    }
  }

  function changed(col) {
    cfg.onChange && cfg.onChange();
    if (col.rerender) render(); else refresh();
  }

  render();
  return { render, refresh };
}
