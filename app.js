// BUG 7 fix: escape HTML in all user-data strings before innerHTML insertion
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

if (typeof pdfjsLib === 'undefined' || typeof Chart === 'undefined') {
  document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem;font-family:monospace;color:#ff5c5c;background:#08080d;padding:2rem;text-align:center;"><div style="font-size:1.5rem;">⚠ Failed to load libraries</div><div style="color:#8888a0;font-size:13px;">PDF.js or Chart.js did not load. Check your internet connection and reload the page.</div></div>';
  throw new Error('Libraries not loaded');
}
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const INR0 = n => n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const INR2 = n => n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Consistent YYYY-MM-DD key for date lookups across both PhonePe and GPay date string formats
const toIso = d => (d && !isNaN(+d))
  ? d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0')
  : '';

function fmtAmt(n, opts = {}) {
  const s = n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0, ...opts });
  const numStr = s.replace(/^₹\s?/, '');
  const [intPart, decPart] = numStr.split('.');
  return `<span class="mv-sym">₹</span><span class="mv-int">${intPart}</span>${decPart ? `<span class="mv-dec">.${decPart}</span>` : ''}`;
}

// ── Categories ──
const CATS = [
  { name: 'Food & dining',      color: '#4d9fff', kw: ['hotel','cafe','restaurant','food','tiffin','canteen','swiggy','zomato','bhojanalaya','khanavali','gokula','annapoorn','avenue food','udupi','majestic'] },
  { name: 'Groceries',          color: '#00c896', kw: ['zepto','instamart','bigbasket','grofer','dmart','supermarket','mart','royalmart','fruits','ismiel','ismael'] },
  { name: 'Fuel & vehicle',     color: '#ffab40', kw: ['petrol','fuel','service station','auto care','saptagiri','bhagirathi','hp auto','bp petrol','kodikrupa'] },
  { name: 'Transport',          color: '#fd79a8', kw: ['metro','bangalore metro','nwkrtc','bus','cab','uber','ola','rapido','auto'] },
  { name: 'Loans & EMIs',       color: '#ff5c5c', kw: ['kreditbee','fibe','slice','loan','emi','credit'] },
  { name: 'Shopping',           color: '#9d8fff', kw: ['shop','electronic','attibele','apple','amazon','flipkart','myntra','meesho','shreyas'] },
  { name: 'Entertainment',      color: '#00cec9', kw: ['apple media','netflix','spotify','hotstar','prime','youtube'] },
  { name: 'Medical',            color: '#ff9f7a', kw: ['medical','pharmacy','medicare','hospital','clinic','health','doctor'] },
  { name: 'Photo & studio',     color: '#c4a0ff', kw: ['photo','studio','highway digital'] },
  { name: 'Personal transfers', color: '#888',    kw: ['rashmi','rahul','likhith','hemavathi','apoorva','venkatesh','akshay','prabhu','swarupa','hari naik','vidhath','prakash','jeevan','savitha','yeddula','abhishek','mahesh','ramesh','shivana','ramya','zakir'] },
  { name: 'Home remittance',    color: '#ffd166', kw: ['1113'] },
  { name: 'UPI Lite / Wallet',  color: '#06d6a0', kw: ['upi lite','wallet','money added'] },
  { name: 'Other',              color: '#444',    kw: [] }
];
const categorize = name => { const n = name.toLowerCase(); for (const c of CATS) if (c.kw.some(k => n.includes(k))) return c.name; return 'Other'; };
const catColor   = name => CATS.find(c => c.name === name)?.color || '#444';

// ── PDF Parsing ──
function showPasswordModal(reason) {
  return new Promise((resolve, reject) => {
    const overlay = document.getElementById('pwdOverlay');
    const input   = document.getElementById('pwdInput');
    const hint    = document.getElementById('pwdHint');
    const submit  = document.getElementById('pwdSubmit');
    const cancel  = document.getElementById('pwdCancel');

    hint.textContent = reason === 2 ? 'Incorrect password. Please try again.' : 'Enter the password to unlock this document.';
    hint.style.color = reason === 2 ? 'var(--red)' : 'var(--t2)';
    input.value = '';
    overlay.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    const cleanup = () => {
      overlay.style.display = 'none';
      submit.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
    };

    submit.onclick = () => {
      const pwd = input.value.trim();
      if (!pwd) { input.focus(); return; }
      cleanup();
      resolve(pwd);
    };
    cancel.onclick = () => { cleanup(); reject(new Error('__cancelled__')); };
    input.onkeydown = e => { if (e.key === 'Enter') submit.click(); if (e.key === 'Escape') cancel.click(); };
  });
}

async function parsePDF(file) {
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  let cancelled = false;

  loadingTask.onPassword = async (updatePassword, reason) => {
    try {
      const pwd = await showPasswordModal(reason);
      updatePassword(pwd);
    } catch {
      cancelled = true;
      loadingTask.destroy();
    }
  };

  // BUG 1 fix: destroy() rejects loadingTask.promise with an internal engine error,
  // not '__cancelled__'. Catch it here and re-throw with the sentinel string.
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (e) {
    if (cancelled) throw new Error('__cancelled__');
    throw e;
  }

  const loader = document.getElementById('loaderText');
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    // BUG 9 fix: show page progress so multi-page statements don't look frozen
    if (pdf.numPages > 4) loader.textContent = `Reading page ${i} of ${pdf.numPages}...`;
    const p = await pdf.getPage(i);
    const c = await p.getTextContent();
    text += c.items.map(x => x.str).join(' ') + '\n';
  }

  // BUG 5 fix: detect scanned/image-only PDFs before attempting regex parsing
  if (text.trim().length < 200) {
    throw new Error(
      'This PDF has no extractable text — it appears to be a scanned image.\n\n' +
      'SpendLens needs a digital statement with selectable text. ' +
      'Download your statement directly from the PhonePe or Google Pay app.'
    );
  }

  appSource = detectSource(text);
  return appSource === 'gpay' ? extractGPayTransactions(text) : extractTransactions(text);
}

function extractTransactions(text) {
  const txns = [];
  const combined = text.replace(/\s+/g, ' ');
  console.log('[SpendLens] Extracted PDF text (first 3000 chars):\n', combined.slice(0, 3000));

  const pat = /(\w+ \d{1,2}, \d{4}) (\d{1,2}:\d{2} [AP]M) ((?:Paid to|Received from) .+?) (Debit|Credit) INR ([\d,]+\.?\d*)/g;
  let m;
  while ((m = pat.exec(combined)) !== null) {
    const name = m[3].trim()
      .replace(/^(Paid to|Received from)\s+/i, '')
      .replace(/\s*Transaction ID.*$/i, '')
      .replace(/\s*UPI Ref.*$/i, '')
      .trim();
    const amount = parseFloat(m[5].replace(/,/g, ''));
    const type = m[4];
    if (!name || isNaN(amount)) continue;
    txns.push({ date: m[1], time: m[2], dateObj: new Date(m[1] + ' ' + m[2]), name, type, amount, category: type === 'Credit' ? 'Income / received' : categorize(name) });
  }

  // BUG 2 fix: [^D]+? blocked any description containing uppercase 'D'; .+? is safe
  // because the lazy quantifier + literal " Debit INR" anchor stops at the right place.
  const walPat = /(\w+ \d{1,2}, \d{4}) (\d{1,2}:\d{2} [AP]M) (Money added.+?) Debit INR ([\d,]+\.?\d*)/g;
  while ((m = walPat.exec(combined)) !== null) {
    const amount = parseFloat(m[4].replace(/,/g, ''));
    if (isNaN(amount)) continue;
    txns.push({ date: m[1], time: m[2], dateObj: new Date(m[1] + ' ' + m[2]), name: 'UPI Lite top-up', type: 'Debit', amount, category: 'UPI Lite / Wallet' });
  }

  // Fallback: Rs. / ₹ variants
  if (txns.length === 0) {
    const pat2 = /(\w+ \d{1,2}, \d{4}) (\d{1,2}:\d{2} [AP]M) ((?:Paid to|Received from) .+?) (Debit|Credit) (?:Rs\.|₹) ?([\d,]+\.?\d*)/g;
    while ((m = pat2.exec(combined)) !== null) {
      const name = m[3].trim().replace(/^(Paid to|Received from)\s+/i, '').trim();
      const amount = parseFloat(m[5].replace(/,/g, ''));
      const type = m[4];
      if (!name || isNaN(amount)) continue;
      txns.push({ date: m[1], time: m[2], dateObj: new Date(m[1] + ' ' + m[2]), name, type, amount, category: type === 'Credit' ? 'Income / received' : categorize(name) });
    }
  }

  console.log('[SpendLens] Parsed', txns.length, 'transactions');
  return txns.sort((a, b) => a.dateObj - b.dateObj);
}

// ── Source detection ──
function detectSource(text) {
  if (/google pay/i.test(text) || /UPI Transaction ID:/i.test(text)) return 'gpay';
  return 'phonpe';
}

// ── GPay parser ──
const GPAY_MONTHS = {Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};

function parseGPayDateObj(dateStr, timeStr) {
  const dm = dateStr.match(/(\d{1,2}) (\w{3}), (\d{4})/);
  // BUG 8 fix: returning new Date() (now) on parse failure silently corrupts sort order
  // and date-range display. Epoch (Jan 1 1970) makes bad data visibly obvious instead.
  if (!dm) return new Date(0);
  const [, day, mon, year] = dm;
  const d = new Date(+year, GPAY_MONTHS[mon] ?? 0, +day);
  const tm = timeStr.match(/(\d{1,2}):(\d{2}) ([AP]M)/);
  if (tm) {
    let h = +tm[1];
    if (tm[3] === 'PM' && h !== 12) h += 12;
    if (tm[3] === 'AM' && h === 12) h = 0;
    d.setHours(h, +tm[2], 0, 0);
  }
  return d;
}

function extractGPayTransactions(text) {
  const txns = [];
  const combined = text.replace(/\s+/g, ' ');
  console.log('[SpendLens] GPay text (first 3000 chars):\n', combined.slice(0, 3000));

  // DD Mon, YYYY HH:MM AM/PM Paid to/Received from/Self transfer to NAME UPI Transaction ID: NNNN Paid by BANK XXXX ₹AMOUNT
  const pat = /(\d{1,2} \w{3}, \d{4}) (\d{1,2}:\d{2} [AP]M) ((?:Paid to|Received from|Self transfer to) .+?) UPI Transaction ID: \d+ Paid by [^₹]+(₹[\d,]+(?:\.\d+)?)/g;
  let m;
  while ((m = pat.exec(combined)) !== null) {
    const fullDesc = m[3].trim();
    if (/^Self transfer to/i.test(fullDesc)) continue;

    const type = /^Received from/i.test(fullDesc) ? 'Credit' : 'Debit';
    const name = fullDesc.replace(/^(?:Paid to|Received from)\s+/i, '').trim();
    const amount = parseFloat(m[4].replace('₹', '').replace(/,/g, ''));
    if (!name || isNaN(amount)) continue;

    const dateStr = m[1]; // "01 Apr, 2026"
    const timeStr = m[2];
    // Format date as "Apr 01, 2026" so new Date() parses it reliably in the dashboard
    const dm2 = dateStr.match(/(\d{1,2}) (\w{3}), (\d{4})/);
    const fmtDate = dm2 ? `${dm2[2]} ${dm2[1].padStart(2, '0')}, ${dm2[3]}` : dateStr;
    txns.push({ date: fmtDate, time: timeStr, dateObj: parseGPayDateObj(dateStr, timeStr), name, type, amount, category: type === 'Credit' ? 'Income / received' : categorize(name) });
  }

  console.log('[SpendLens] GPay parsed', txns.length, 'transactions');
  return txns.sort((a, b) => a.dateObj - b.dateObj);
}

// ── State ──
let allTxns = [], activeFilter = 'All', charts = {}, appSource = '', cumulState = null;

function resetApp() {
  allTxns = [];
  appSource = '';
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
  charts = {};
  cumulState = null;
  clearSession(); // explicit "new upload" clears persisted data
  document.getElementById('dlBtn').style.display = 'none';
  document.getElementById('upload-screen').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
}

// ── Session persistence ──────────────────────────────────────────────────────
// sessionStorage: scoped to the tab, cleared on browser close, no server needed.

function saveSession() {
  try {
    sessionStorage.setItem('spendlens_session', JSON.stringify({
      v: 1,
      source: appSource,
      txns: allTxns.map(t => ({
        date:   t.date,   time:   t.time,
        dateTs: t.dateObj ? +t.dateObj : null, // serialize Date as timestamp
        name:   t.name,   type:   t.type,
        amount: t.amount, category: t.category
      }))
    }));
  } catch (e) {
    console.warn('[SpendLens] sessionStorage write failed:', e.message);
  }
}

function clearSession() {
  try { sessionStorage.removeItem('spendlens_session'); } catch {}
}

function hydrateSession() {
  // Parse — any malformed JSON clears the key and falls through to upload screen
  let data = null;
  try {
    const raw = sessionStorage.getItem('spendlens_session');
    if (raw) data = JSON.parse(raw);
  } catch {
    clearSession();
  }

  // Always remove the anti-flash style tag injected in the <head>,
  // whether we restore successfully or fall back — display is now JS-controlled.
  document.getElementById('ss-hide')?.remove();

  if (!data || data.v !== 1 || !Array.isArray(data.txns) || !data.txns.length) {
    if (data) clearSession(); // clear structurally wrong data; missing key is fine as-is
    document.getElementById('upload-screen').style.display = 'flex';
    return;
  }

  try {
    appSource = data.source || 'phonpe';
    allTxns   = data.txns.map(t => ({
      date:    t.date,
      time:    t.time,
      dateObj: t.dateTs != null ? new Date(t.dateTs) : null,
      name:    t.name,
      type:    t.type,
      amount:  t.amount,
      category: t.category
    }));
    document.getElementById('upload-screen').style.display = 'none';
    document.getElementById('dashboard').style.display     = 'block';
    renderDashboard(allTxns);
    window.scrollTo(0, 0);
  } catch (e) {
    console.error('[SpendLens] Session restore failed:', e);
    clearSession();
    allTxns = []; appSource = '';
    document.getElementById('upload-screen').style.display = 'flex';
    document.getElementById('dashboard').style.display     = 'none';
  }
}

// ── Dashboard ──
function renderDashboard(txns) {
  const debits  = txns.filter(t => t.type === 'Debit');
  const credits = txns.filter(t => t.type === 'Credit');
  const totalD  = debits.reduce((s, t) => s + t.amount, 0);
  const totalC  = credits.reduce((s, t) => s + t.amount, 0);
  const net     = totalC - totalD;
  const avg     = debits.length ? totalD / debits.length : 0;
  const maxT    = debits.reduce((m, t) => t.amount > m.amount ? t : m, debits[0] || { amount: 0 });
  const dates   = txns.map(t => t.dateObj).filter(Boolean);
  // BUG 3 fix: Math.min/max spread crashes with "Maximum call stack size exceeded"
  // on statements with hundreds of transactions. Use reduce instead.
  const d0      = dates.length ? dates.reduce((a, b) => +a < +b ? a : b) : new Date();
  const d1      = dates.length ? dates.reduce((a, b) => +a > +b ? a : b) : new Date();
  const fmt     = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const sourceBadge = appSource === 'gpay'
    ? '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:rgba(66,133,244,0.18);color:#4285f4;margin-right:8px;">GPay</span>'
    : '<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;background:rgba(99,60,180,0.18);color:#a78bfa;margin-right:8px;">PhonePe</span>';
  document.getElementById('topbarMeta').innerHTML = `${sourceBadge}${fmt(d0)} — ${fmt(d1)} · ${txns.length} transactions`;

  // Metrics
  const ms = [
    { lbl: 'Total debits',    val: fmtAmt(totalD, { maximumFractionDigits: 0 }),              note: debits.length + ' transactions',                               cls: 'c-red'    },
    { lbl: 'Total credits',   val: fmtAmt(totalC, { maximumFractionDigits: 0 }),              note: credits.length + ' transactions',                              cls: 'c-green'  },
    { lbl: 'Net outflow',     val: fmtAmt(Math.abs(net), { maximumFractionDigits: 0 }),       note: net < 0 ? 'Spent more than received' : 'Surplus this period',  cls: net < 0 ? 'c-amber' : 'c-teal' },
    { lbl: 'Avg payment',     val: fmtAmt(Math.round(avg)),                                   note: 'Per debit',                                                   cls: 'c-purple' },
    { lbl: 'Transactions',    val: `<span class="mv-int">${txns.length}</span>`,              note: 'Debits + credits',                                            cls: 'c-blue'   },
    { lbl: 'Largest payment', val: fmtAmt(maxT.amount || 0, { maximumFractionDigits: 0 }),    note: (maxT.name || '').slice(0, 18),                                cls: 'c-red'    }
  ];
  document.getElementById('metricStrip').innerHTML = ms.map(m => `
    <div class="metric ${m.cls} fade-in">
      <div class="m-lbl">${m.lbl}</div>
      <div class="m-val">${m.val}</div>
      <div class="m-note">${m.note}</div>
    </div>`).join('');

  // Categories
  const catMap = {};
  debits.forEach(t => { catMap[t.category] = (catMap[t.category] || 0) + t.amount; });
  const catSorted = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const catLabels = catSorted.map(c => c[0]);
  const catVals   = catSorted.map(c => c[1]);
  const catCols   = catLabels.map(catColor);

  // Donut chart
  const sliceLabelPlugin = {
    id: 'sliceLabels',
    afterDatasetDraw(chart) {
      const { ctx } = chart;
      const meta  = chart.getDatasetMeta(0);
      const vals  = chart.data.datasets[0].data;
      const total = vals.reduce((a, b) => a + b, 0);
      if (!total) return;
      meta.data.forEach((arc, i) => {
        const pct = vals[i] / total * 100;
        if (pct < 8) return;
        const { x, y } = arc.tooltipPosition();
        ctx.save();
        ctx.fillStyle  = 'rgba(255,255,255,0.92)';
        ctx.font       = '600 11px Inter, sans-serif';
        ctx.textAlign  = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(Math.round(pct) + '%', x, y);
        ctx.restore();
      });
    }
  };

  if (charts.donut) charts.donut.destroy();
  charts.donut = new Chart(document.getElementById('donutChart'), {
    type: 'doughnut',
    data: { labels: catLabels, datasets: [{ data: catVals, backgroundColor: catCols, borderWidth: 2, borderColor: '#0f0f17', hoverOffset: 6 }] },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${INR0(ctx.parsed)} (${Math.round(ctx.parsed / totalD * 100)}%)` } } }
    },
    plugins: [sliceLabelPlugin]
  });

  document.getElementById('donutLegend').innerHTML = catLabels.map((l, i) => {
    const pct     = Math.round(catVals[i] / totalD * 100);
    const isSmall = pct < 8;
    return `<span style="display:flex;align-items:center;gap:5px;font-size:10px;font-family:'JetBrains Mono',monospace;color:${isSmall ? 'var(--t1)' : 'var(--t2)'};">
      <span style="width:8px;height:8px;border-radius:2px;background:${catCols[i]};flex-shrink:0;"></span>${l}&nbsp;<span style="color:${isSmall ? catCols[i] : 'inherit'};font-weight:${isSmall ? 600 : 400};">${pct}%</span>
    </span>`;
  }).join('');

  // Category bars
  const maxC = catVals[0] || 1;
  document.getElementById('catBars').innerHTML = catSorted.slice(0, 9).map(([name, amt]) => {
    const pct = Math.round(amt / totalD * 100);
    const w   = Math.round(amt / maxC * 100);
    return `<div class="cat-row">
      <div class="cat-top"><span class="cat-name">${name}</span><span class="cat-meta">${INR0(amt)} · <span class="cat-meta-pct">${pct}%</span></span></div>
      <div class="bar-bg"><div class="bar-fill" style="width:${w}%;background:${catColor(name)};"></div></div>
    </div>`;
  }).join('');

  // Daily trend
  const dayMap = {};
  debits.forEach(t => { dayMap[t.date] = (dayMap[t.date] || 0) + t.amount; });
  const days = Object.keys(dayMap).sort((a, b) => new Date(a) - new Date(b));

  // P95 cap + average
  const sortedVals = days.map(d => dayMap[d]).slice().sort((a, b) => a - b);
  const p95    = sortedVals[Math.min(Math.floor(sortedVals.length * 0.95), sortedVals.length - 1)] || 1;
  const avgDay = days.length ? days.reduce((s, d) => s + dayMap[d], 0) / days.length : 0;

  const refLinesPlugin = {
    id: 'refLines',
    afterDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
      if (!y) return;

      const drawLine = (value, strokeStyle, dash, fillStyle, label, baseline) => {
        const yPx = y.getPixelForValue(value);
        if (yPx <= top || yPx >= bottom) return;
        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth   = 1;
        ctx.setLineDash(dash);
        ctx.beginPath();
        ctx.moveTo(left, yPx);
        ctx.lineTo(right, yPx);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle    = fillStyle;
        ctx.font         = '10px JetBrains Mono, monospace';
        ctx.textAlign    = 'right';
        ctx.textBaseline = baseline;
        ctx.fillText(label, right - 4, baseline === 'bottom' ? yPx - 3 : yPx + 3);
        ctx.restore();
      };

      // Average line — drawn first so cap line renders on top
      const avgLabel = 'Avg ' + avgDay.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }) + '/day';
      drawLine(avgDay, 'rgba(160,160,190,0.55)', [3, 3], 'rgba(160,160,190,0.8)', avgLabel, 'top');

      // Scale cap line
      drawLine(p95, 'rgba(255,171,64,0.55)', [5, 4], 'rgba(255,171,64,0.75)', 'scale cap', 'bottom');
    }
  };

  if (charts.line) charts.line.destroy();
  charts.line = new Chart(document.getElementById('lineChart'), {
    type: 'line',
    data: {
      labels: days.map(d => { const x = new Date(d); return x.getDate() + '/' + (x.getMonth() + 1); }),
      datasets: [{
        data: days.map(d => dayMap[d]),
        borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.08)',
        borderWidth: 2, fill: true, tension: 0.4, clip: false,
        pointRadius: days.map(d => dayMap[d] > p95 ? 5.5 : 4),
        pointBackgroundColor: days.map(d => dayMap[d] > p95 ? '#ffab40' : '#818cf8'),
        pointBorderColor: days.map(d => dayMap[d] > p95 ? '#fff' : '#818cf8'),
        pointBorderWidth: days.map(d => dayMap[d] > p95 ? 1.5 : 0)
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => {
          const v = ctx.parsed.y;
          return v > p95 ? ` ${INR0(v)}  ↑ above scale` : ` ${INR0(v)}`;
        }}}
      },
      scales: {
        y: { max: p95, ticks: { callback: v => v >= 1000 ? '₹' + (v / 1000).toFixed(0) + 'K' : INR0(v), font: { size: 12, family: 'JetBrains Mono' }, color: '#9090b8' }, grid: { color: 'rgba(255,255,255,0.03)' } },
        x: { ticks: { font: { size: 12, family: 'JetBrains Mono' }, color: '#9090b8', maxRotation: 45, autoSkip: true, maxTicksLimit: 18 }, grid: { display: false } }
      }
    },
    plugins: [refLinesPlugin]
  });

  // Top 10 payments
  const top10 = [...debits].sort((a, b) => b.amount - a.amount).slice(0, 10);
  const top10Max = top10[0]?.amount || 1;
  document.getElementById('topTxnList').innerHTML = top10.map((t, i) => {
    const col     = catColor(t.category);
    const barW    = Math.round(t.amount / top10Max * 100);
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--s2);border-radius:var(--rs);margin-bottom:5px;">
      <span style="font-size:10px;color:var(--t3);font-family:'JetBrains Mono',monospace;width:16px;flex-shrink:0;">${i + 1}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(t.name)}</div>
        <div style="font-size:10px;color:var(--t3);font-family:'JetBrains Mono',monospace;">${t.category}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;">
        <div style="font-size:15px;font-weight:600;font-family:'JetBrains Mono',monospace;color:#fbbf24;">${INR0(t.amount)}</div>
        <div style="margin-top:3px;height:4px;width:80px;background:rgba(99,102,241,0.4);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${barW}%;background:#6366f1;border-radius:2px;transition:width 0.5s cubic-bezier(0.22,1,0.36,1);"></div>
        </div>
      </div>
    </div>`;
  }).join('');

  // Vendors
  const venMap = {};
  debits.forEach(t => { const k = t.name.toUpperCase().trim(); if (!venMap[k]) venMap[k] = { name: t.name, count: 0, total: 0 }; venMap[k].count++; venMap[k].total += t.amount; });
  const topVen = Object.values(venMap).sort((a, b) => b.count - a.count).slice(0, 8);
  document.getElementById('vendorList').innerHTML = topVen.map((v, i) => `
    <div class="vendor-item">
      <span class="v-rank">${i + 1}</span>
      <span class="v-name">${escHtml(v.name.slice(0, 22))}</span>
      <span class="v-count">${v.count}×</span>
      <span class="v-amt">${INR0(v.total)}</span>
    </div>`).join('');

  // ── Cumulative Spend Chart ──
  // Pre-compute both ISO maps — toggle and range never re-parse transactions
  const debitIsoMap = {}, creditIsoMap = {};
  debits.forEach(t => { const k = toIso(t.dateObj); if (k) debitIsoMap[k] = (debitIsoMap[k] || 0) + t.amount; });
  credits.forEach(t => { const k = toIso(t.dateObj); if (k) creditIsoMap[k] = (creditIsoMap[k] || 0) + t.amount; });

  // Build raw daily arrays for both modes across the full calendar range (including ₹0 days)
  const cDays = [], cDebitDaily = [], cCreditDaily = [];
  const cStart = new Date(d0); cStart.setHours(0,0,0,0);
  const cEnd   = new Date(d1); cEnd.setHours(0,0,0,0);
  for (let cur = new Date(cStart); +cur <= +cEnd; cur.setDate(cur.getDate() + 1)) {
    const k = toIso(cur);
    cDays.push(new Date(cur));
    cDebitDaily.push(debitIsoMap[k] || 0);
    cCreditDaily.push(creditIsoMap[k] || 0);
  }

  // Initialise shared state with debit + all as the default view
  const initDebitView  = buildCumulView({ days: cDays, debitDaily: cDebitDaily, creditDaily: cCreditDaily }, 'debit',  'all');
  const initCreditView = buildCumulView({ days: cDays, debitDaily: cDebitDaily, creditDaily: cCreditDaily }, 'credit', 'all');
  cumulState = {
    mode: 'debit', range: 'all',
    days: cDays, debitDaily: cDebitDaily, creditDaily: cCreditDaily,
    // primary single-mode view
    viewDays:  initDebitView.viewDays,  viewDaily: initDebitView.viewDaily,
    viewCumul: initDebitView.viewCumul, viewTotal: initDebitView.viewTotal, viewPeak: initDebitView.viewPeak,
    // both-mode series (always kept in sync with current range)
    viewDailyD: initDebitView.viewDaily,  viewCumulD: initDebitView.viewCumul,  viewTotalD: initDebitView.viewTotal,
    viewDailyC: initCreditView.viewDaily, viewCumulC: initCreditView.viewCumul, viewTotalC: initCreditView.viewTotal,
  };

  const cumulPlugin = {
    id: 'cumulMeta',
    afterDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom }, scales: { x, y } } = chart;
      if (!x || !y || !cumulState?.viewDays?.length) return;
      const { viewDays, viewDaily, viewCumul } = cumulState;
      // Always use the chart's current label array for pixel lookups.
      // Passing an integer index to a CategoryScale with string labels ("1/5", "2/5"…)
      // causes Chart.js to misresolve the position — pass the label string instead.
      const labels = chart.data.labels;

      // ── Month boundary dividers ──────────────────────────────────────────────
      for (let i = 1; i < viewDays.length; i++) {
        if (viewDays[i].getMonth() === viewDays[i-1].getMonth()) continue;
        const xPx = x.getPixelForValue(labels[i]);
        if (xPx == null || xPx <= left || xPx >= right) continue;
        const lbl = viewDays[i].toLocaleString('en-IN', { month: 'short' }) + ' ' + viewDays[i].getFullYear();
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(xPx, top); ctx.lineTo(xPx, bottom); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(160,160,190,0.5)'; ctx.font = '9px JetBrains Mono, monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
        ctx.fillText(lbl, xPx + 3, bottom - 2);
        ctx.restore();
      }

      const isBoth = cumulState.mode === 'both';

      if (isBoth) {
        // ── Both mode: two average lines (debit red, credit green) ──────────────
        const fmtAvg = v => (v >= 1000
          ? '₹' + (v / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
          : '₹' + Math.round(v).toLocaleString('en-IN'));
        const drawAvgLine = (avgVal, stroke, label) => {
          if (!(avgVal > 0)) return;
          const avgY = y.getPixelForValue(avgVal);
          if (avgY <= top || avgY >= bottom) return;
          ctx.save();
          ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.setLineDash([6, 3]);
          ctx.beginPath(); ctx.moveTo(left, avgY); ctx.lineTo(right, avgY); ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '500 9px JetBrains Mono, monospace';
          const aw = ctx.measureText(label).width + 6;
          ctx.fillStyle = 'rgba(18,18,28,0.75)';
          ctx.fillRect(right - aw - 1, avgY - 7, aw + 2, 14);
          ctx.fillStyle = stroke; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(label, right - 3, avgY);
          ctx.restore();
        };
        const avgD = viewDays.length ? cumulState.viewTotalD / viewDays.length : 0;
        const avgC = viewDays.length ? cumulState.viewTotalC / viewDays.length : 0;
        drawAvgLine(avgD, 'rgba(255,92,92,0.75)',   'Avg ' + fmtAvg(avgD) + '/day spent');
        drawAvgLine(avgC, 'rgba(0,200,150,0.75)',   'Avg ' + fmtAvg(avgC) + '/day received');

        // ── Crossover marker: first day credit cumul overtakes debit cumul ──────
        const vD = cumulState.viewCumulD, vC = cumulState.viewCumulC;
        let crossIdx = -1;
        for (let i = 1; i < vD.length; i++) {
          if (vC[i] >= vD[i] && vC[i - 1] < vD[i - 1]) { crossIdx = i; break; }
        }
        if (crossIdx >= 0) {
          const cxPx = x.getPixelForValue(labels[crossIdx]);
          const midVal = (vD[crossIdx] + vC[crossIdx]) / 2;
          const cyPx  = y.getPixelForValue(midVal);
          if (cxPx >= left && cxPx <= right && cyPx >= top && cyPx <= bottom) {
            ctx.save();
            ctx.beginPath(); ctx.arc(cxPx, cyPx, 5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,230,80,0.45)'; ctx.fill();
            ctx.strokeStyle = 'rgba(255,230,80,0.85)'; ctx.lineWidth = 1.2; ctx.stroke();
            const lbl = 'Net +';
            ctx.font = '600 9px Inter, sans-serif';
            const lw2 = ctx.measureText(lbl).width + 8;
            const lx2 = Math.min(cxPx + 8, right - lw2);
            ctx.fillStyle = 'rgba(18,18,28,0.88)';
            ctx.fillRect(lx2, cyPx - 9, lw2, 14);
            ctx.fillStyle = 'rgba(255,230,80,0.95)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText(lbl, lx2 + 4, cyPx - 2);
            ctx.restore();
          }
        }
        return; // skip single-mode peak annotation in both mode
      }

      // ── Single mode: average line (amber) ────────────────────────────────────
      const avgPerDay  = viewDays.length ? (cumulState.viewTotal ?? 0) / viewDays.length : 0;
      if (avgPerDay > 0) {
        const avgY = y.getPixelForValue(avgPerDay);
        if (avgY > top && avgY < bottom) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,171,64,0.38)';
          ctx.lineWidth   = 1;
          ctx.setLineDash([6, 3]);
          ctx.beginPath(); ctx.moveTo(left, avgY); ctx.lineTo(right, avgY); ctx.stroke();
          ctx.setLineDash([]);
          const avgLbl = 'Avg ' + (avgPerDay >= 1000
            ? '₹' + (avgPerDay / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
            : '₹' + Math.round(avgPerDay).toLocaleString('en-IN')) + '/day';
          ctx.font = '500 9px JetBrains Mono, monospace';
          const aw = ctx.measureText(avgLbl).width + 6;
          ctx.fillStyle = 'rgba(18,18,28,0.75)';
          ctx.fillRect(right - aw - 1, avgY - 7, aw + 2, 14);
          ctx.fillStyle    = 'rgba(255,171,64,0.85)';
          ctx.textAlign    = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(avgLbl, right - 3, avgY);
          ctx.restore();
        }
      }

      // ── Peak annotation ──────────────────────────────────────────────────────
      if (!viewDaily.length) return;
      const peakIdx = viewDaily.reduce((b, v, i) => v > viewDaily[b] ? i : b, 0);
      if (viewDaily[peakIdx] <= 0) return;

      const xPx = x.getPixelForValue(labels[peakIdx]);
      const yPx = y.getPixelForValue(viewCumul[peakIdx]);
      if (xPx == null || xPx < left || xPx > right) return;

      const nearRight = xPx > left + (right - left) * 0.75;
      const nearTop   = yPx < top + 22;
      ctx.save();
      ctx.fillStyle    = '#ffab40';
      ctx.font         = '600 10px Inter, sans-serif';
      ctx.textAlign    = nearRight ? 'right' : 'center';
      ctx.textBaseline = nearTop   ? 'top'   : 'bottom';
      ctx.fillText(
        '+' + INR0(viewDaily[peakIdx]),
        xPx + (nearRight ? -8 : 0),
        nearTop ? yPx + 12 : yPx - 10
      );
      ctx.restore();
    }
  };

  if (charts.cumul) charts.cumul.destroy();
  charts.cumul = new Chart(document.getElementById('cumulChart'), {
    type: 'line',
    data: {
      labels: cumulState.viewDays.map(d => d.getDate() + '/' + (d.getMonth() + 1)),
      datasets: [
        {
          data: cumulState.viewCumul,
          borderColor: '#ff5c5c', backgroundColor: 'rgba(255,92,92,0.07)',
          borderWidth: 2, fill: true, tension: 0.35, clip: false,
          pointRadius:          cumulState.viewDaily.map((v, i) => i === cumulState.viewPeak ? 6 : (v > 0 ? 2 : 0)),
          pointBackgroundColor: cumulState.viewDaily.map((v, i) => i === cumulState.viewPeak ? '#ffab40' : '#ff5c5c'),
          pointBorderColor:     cumulState.viewDaily.map((v, i) => i === cumulState.viewPeak ? '#fff'    : '#ff5c5c'),
          pointBorderWidth:     cumulState.viewDaily.map((v, i) => i === cumulState.viewPeak ? 2         : 0)
        },
        {
          data: [], hidden: true,
          borderColor: '#00c896', backgroundColor: 'rgba(0,200,150,0.1)',
          borderWidth: 2, fill: true, tension: 0.35, clip: false,
          pointRadius: [], pointBackgroundColor: [], pointBorderColor: [], pointBorderWidth: []
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false } // crosshair overlay renders the label inline
      },
      scales: {
        y: {
          min: 0,
          ticks: { callback: v => v >= 1000 ? '₹' + (v/1000).toFixed(0) + 'K' : INR0(v), font: { size: 12, family: 'JetBrains Mono' }, color: '#9090b8' },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        x: {
          ticks: {
            // Fix 1: force one tick per day — no skipping — rotated to prevent overlap
            autoSkip: false,
            maxRotation: 45,
            minRotation: 0,
            font: { size: 10, family: 'JetBrains Mono' },
            color: '#9090b8',
            // Show D/M on first tick and on the 1st of each new month; bare day number otherwise
            callback: (val, i) => {
              const d = cumulState?.viewDays?.[i];
              if (!d) return val;
              return (i === 0 || d.getDate() === 1)
                ? d.getDate() + '/' + (d.getMonth() + 1)
                : String(d.getDate());
            }
          },
          grid: { display: false }
        }
      }
    },
    plugins: [cumulPlugin]
  });

  // Sync both selectors to the initial Debit + All state
  applyCumulToggleStyle('debit');
  applyCumulRangeStyle('all');

  // ── Crosshair overlay ──
  const crossCanvas = document.getElementById('cumulCrosshair');
  if (crossCanvas) {
    // Size the overlay to match the chart canvas exactly, respecting device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    const cw  = Math.round(charts.cumul.canvas.width  / dpr); // CSS pixels
    const ch  = Math.round(charts.cumul.canvas.height / dpr);
    crossCanvas.width  = cw * dpr;   // physical pixels
    crossCanvas.height = ch * dpr;
    crossCanvas.style.width  = cw + 'px';
    crossCanvas.style.height = ch + 'px';
    const crossCtx = crossCanvas.getContext('2d');
    crossCtx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS-pixel coordinates

    // Store on cumulState so updateCumul can clear on data change
    cumulState.crossCtx = crossCtx;
    cumulState.crossCW  = cw;
    cumulState.crossCH  = ch;

    // onmousemove replaces itself on re-render (no listener stacking)
    charts.cumul.canvas.onmousemove = e => {
      if (!cumulState?.viewDays?.length || !charts.cumul) return;
      const chart  = charts.cumul;
      const rect   = chart.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const { left, right } = chart.chartArea;

      crossCtx.clearRect(0, 0, cw, ch);
      if (mouseX < left || mouseX > right) return;

      const xScale = chart.scales.x;
      const rawIdx = xScale.getValueForPixel(mouseX);
      if (rawIdx == null || isNaN(rawIdx)) return;
      const dataIndex = Math.round(Math.max(0, Math.min(rawIdx, chart.data.labels.length - 1)));

      // Pass the label string, not the integer index — same fix as the plugin annotation
      const snapX = xScale.getPixelForValue(chart.data.labels[dataIndex] ?? dataIndex);
      const yVal  = chart.data.datasets[0].data[dataIndex] ?? 0;
      const snapY = chart.scales.y.getPixelForValue(yVal);

      drawCumulCrosshair(crossCtx, chart, snapX, snapY, dataIndex, yVal);
    };

    charts.cumul.canvas.onmouseleave = () => {
      crossCtx.clearRect(0, 0, cw, ch);
    };
  }

  // Hour chart
  const hourMap   = Array(24).fill(0);
  const hourCount = Array(24).fill(0);
  debits.forEach(t => {
    const h = t.dateObj?.getHours() || 0;
    hourMap[h]   += t.amount;
    hourCount[h] += 1;
  });
  const hourAvg = hourMap.reduce((a, b) => a + b, 0) / 24;
  const hourAvgPlugin = {
    id: 'hourAvg',
    afterDraw(chart) {
      const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
      if (!y) return;
      const yPx = y.getPixelForValue(hourAvg);
      if (yPx <= top || yPx >= bottom) return;
      ctx.save();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(left, yPx);
      ctx.lineTo(right, yPx);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle    = '#6366f1';
      ctx.font         = '10px JetBrains Mono, monospace';
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText('avg', right - 4, yPx - 3);
      ctx.restore();
    }
  };

  if (charts.hour) charts.hour.destroy();
  charts.hour = new Chart(document.getElementById('hourChart'), {
    type: 'bar',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => i % 6 === 0 ? i + 'h' : ''),
      datasets: [{ data: hourMap, backgroundColor: hourMap.map(v => v > 5000 ? '#ff5c5c' : v > 1000 ? '#ffab40' : '#6c5ce7'), borderRadius: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          title: ctx => ctx[0].dataIndex + ':00 – ' + ctx[0].dataIndex + ':59',
          label: ctx => ` ${INR0(ctx.parsed.y)}`,
          afterLabel: ctx => {
            const n = hourCount[ctx.dataIndex];
            return n ? ` ${n} transaction${n !== 1 ? 's' : ''}` : '';
          }
        }}
      },
      scales: {
        y: {
          title: { display: true, text: '₹ Spent', color: '#9090b8', font: { size: 11, family: 'JetBrains Mono, monospace' }, padding: { bottom: 4 } },
          ticks: { callback: v => v >= 1000 ? '₹' + (v / 1000).toFixed(0) + 'K' : INR0(v), font: { size: 12, family: 'JetBrains Mono' }, color: '#9090b8' },
          grid: { color: 'rgba(255,255,255,0.03)' }
        },
        x: { ticks: { font: { size: 12, family: 'JetBrains Mono' }, color: '#9090b8' }, grid: { display: false } }
      }
    },
    plugins: [hourAvgPlugin]
  });

  // Budget
  const budgetCats = ['Food & dining', 'Groceries', 'Fuel & vehicle', 'Transport', 'Shopping', 'Entertainment', 'Medical'];
  document.getElementById('budgetList').innerHTML = budgetCats.filter(c => catMap[c]).map(c => {
    const actual  = catMap[c];
    const target  = Math.max(Math.round(actual * 0.75 / 100) * 100, 100);
    const rawPct  = actual / target * 100;
    const fillPct = Math.min(rawPct, 100);
    const col     = rawPct < 75 ? '#00c896' : rawPct <= 90 ? '#ffab40' : '#ff5c5c';
    return `<div>
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;">
        <span style="font-weight:500;">${c}</span>
        <span style="font-family:'JetBrains Mono',monospace;color:#b0b0cc;font-size:13px;">${INR0(actual)} / ${INR0(target)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="flex:1;height:4px;background:var(--s3);border-radius:2px;overflow:hidden;">
          <div style="height:100%;width:${fillPct}%;background:${col};border-radius:2px;transition:width 0.6s cubic-bezier(0.22,1,0.36,1);"></div>
        </div>
        <span style="font-size:14px;font-weight:700;font-family:'JetBrains Mono',monospace;color:${rawPct > 100 ? '#ef4444' : '#22c55e'};min-width:42px;text-align:right;">${Math.round(rawPct)}%</span>
      </div>
    </div>`;
  }).join('');

  // Transaction table + filters
  renderTxnTable(txns, 'All');
  const cats = ['All', ...new Set(txns.map(t => t.type === 'Credit' ? 'Income / received' : t.category))];
  document.getElementById('filterRow').innerHTML = cats.map(c => `
    <button class="chip ${c === 'All' ? 'active' : ''}" onclick="filterTxns('${c}')">${c}</button>`).join('');

  // Insights
  const insights = genInsights(debits, credits, catMap, venMap, totalD);
  document.getElementById('insightGrid').innerHTML = insights.map(ins => `
    <div class="insight ${ins.type} fade-in">
      <div class="ins-icon">${ins.icon}</div>
      <div class="ins-title">${ins.title}</div>
      <div class="ins-body">${ins.body}</div>
    </div>`).join('');

  // Anomalies
  const anomalies = detectAnomalies(debits, dayMap, venMap);
  document.getElementById('anomalyList').innerHTML = anomalies.map(a => `
    <div class="anomaly an-${a.level}">
      <div class="an-title">${a.title}</div>
      <div class="an-desc">${a.desc}</div>
    </div>`).join('') || '<div style="color:var(--t3);font-size:12px;">No major anomalies detected.</div>';

  // Health score
  const score  = calcScore(catMap, debits, totalD, net);
  const sClass = score >= 70 ? 'sb-good' : score >= 45 ? 'sb-mod' : 'sb-bad';
  const sLabel = score >= 70 ? 'Healthy' : score >= 45 ? 'Moderate' : 'Needs work';
  const sColor = score >= 70 ? 'var(--green)' : score >= 45 ? 'var(--amber)' : 'var(--red)';
  document.getElementById('scoreCard').innerHTML = `
    <div>
      <div class="score-lbl">Financial health score</div>
      <div class="score-val" style="color:${sColor};">${score}<span style="font-size:20px;color:#8888a8;">/100</span></div>
      <div class="score-title">Overall: ${sLabel}</div>
      <div class="score-desc">${verdictDesc(score, catMap, totalD, net)}</div>
    </div>
    <div><span class="score-badge ${sClass}">${sLabel}</span></div>`;

  // Spending summary
  const summaryLines = genSmartSummary(debits, credits, catMap, dayMap, topVen, totalD, totalC, net, d0, d1);
  document.getElementById('summaryText').innerHTML = '<ul>' + summaryLines.map(l => `<li>${l}</li>`).join('') + '</ul>';

  document.getElementById('dlBtn').style.display = 'inline-block';
}

// Slice + rebaseline a cumulative series to the requested range window
function buildCumulView(state, mode, range) {
  const rawDaily = mode === 'debit' ? state.debitDaily : state.creditDaily;
  const n = rawDaily.length;
  const win   = range === '1w' ? 7 : range === '2w' ? 14 : range === '1m' ? 30 : Infinity;
  const start = isFinite(win) ? Math.max(0, n - win) : 0;
  const viewDays  = state.days.slice(start);
  const viewDaily = rawDaily.slice(start);
  let run = 0;
  const viewCumul = viewDaily.map(v => { const prev = run; run += v; return prev; });
  const viewTotal = run;
  const viewPeak  = viewDaily.length ? viewDaily.reduce((b, v, i) => v > viewDaily[b] ? i : b, 0) : 0;
  return { viewDays, viewDaily, viewCumul, viewTotal, viewPeak };
}

// Colour-matched active styling for the Debit / Credit / Both toggle
function applyCumulToggleStyle(mode) {
  const isDebit  = mode === 'debit';
  const isCredit = mode === 'credit';
  const isBoth   = mode === 'both';
  const debitBtn  = document.getElementById('cumulDebitBtn');
  const creditBtn = document.getElementById('cumulCreditBtn');
  const bothBtn   = document.getElementById('cumulBothBtn');
  if (debitBtn) {
    debitBtn.classList.toggle('active', isDebit);
    debitBtn.style.borderColor = isDebit ? '#ff5c5c' : '';
    debitBtn.style.color       = isDebit ? '#ff5c5c' : '';
    debitBtn.style.background  = isDebit ? 'rgba(255,92,92,0.1)' : '';
  }
  if (creditBtn) {
    creditBtn.classList.toggle('active', isCredit);
    creditBtn.style.borderColor = isCredit ? '#00c896' : '';
    creditBtn.style.color       = isCredit ? '#00c896' : '';
    creditBtn.style.background  = isCredit ? 'rgba(0,200,150,0.1)' : '';
  }
  if (bothBtn) {
    bothBtn.classList.toggle('active', isBoth);
    bothBtn.style.borderColor = isBoth ? '#9090b8' : '';
    bothBtn.style.color       = isBoth ? '#e2e2f0' : '';
    bothBtn.style.background  = isBoth ? 'linear-gradient(90deg, rgba(255,92,92,0.15) 50%, rgba(0,200,150,0.15) 50%)' : '';
  }
}

// Highlight the active range pill
function applyCumulRangeStyle(range) {
  ['1w','2w','1m','all'].forEach(r => {
    const btn = document.getElementById('cumulRange' + r);
    if (btn) btn.classList.toggle('active', r === range);
  });
}

// Central update: called by mode toggle and range selector
function updateCumul(mode, range) {
  if (!cumulState || !charts.cumul) return;
  cumulState.mode  = mode;
  cumulState.range = range;

  // Always build both series so both-mode fields stay in sync with the current range
  const dView = buildCumulView(cumulState, 'debit',  range);
  const cView = buildCumulView(cumulState, 'credit', range);

  cumulState.viewDays   = dView.viewDays; // same window for both series
  cumulState.viewDailyD = dView.viewDaily; cumulState.viewCumulD = dView.viewCumul; cumulState.viewTotalD = dView.viewTotal;
  cumulState.viewDailyC = cView.viewDaily; cumulState.viewCumulC = cView.viewCumul; cumulState.viewTotalC = cView.viewTotal;

  const isBoth  = mode === 'both';
  const isDebit = mode === 'debit';

  // Primary-mode view (used by single-mode plugin paths and crosshair)
  const activeView = (mode === 'credit') ? cView : dView;
  cumulState.viewDaily = activeView.viewDaily;
  cumulState.viewCumul = activeView.viewCumul;
  cumulState.viewTotal = activeView.viewTotal;
  cumulState.viewPeak  = activeView.viewPeak;

  const labels = dView.viewDays.map(d => d.getDate() + '/' + (d.getMonth() + 1));
  charts.cumul.data.labels = labels;

  // Dataset 0 — debit line in debit/both mode; credit line in credit mode
  const ds0 = charts.cumul.data.datasets[0];
  if (mode === 'credit') {
    ds0.data = cView.viewCumul;
    ds0.borderColor = '#00c896'; ds0.backgroundColor = 'rgba(0,200,150,0.07)';
    ds0.pointRadius          = cView.viewDaily.map((v, i) => i === cView.viewPeak ? 6 : (v > 0 ? 2 : 0));
    ds0.pointBackgroundColor = cView.viewDaily.map((v, i) => i === cView.viewPeak ? '#ffab40' : '#00c896');
    ds0.pointBorderColor     = cView.viewDaily.map((v, i) => i === cView.viewPeak ? '#fff'    : '#00c896');
    ds0.pointBorderWidth     = cView.viewDaily.map((v, i) => i === cView.viewPeak ? 2         : 0);
  } else {
    ds0.data = dView.viewCumul;
    ds0.borderColor     = '#ff5c5c';
    ds0.backgroundColor = isBoth ? 'rgba(255,92,92,0.1)' : 'rgba(255,92,92,0.07)';
    ds0.pointRadius          = dView.viewDaily.map((v, i) => i === dView.viewPeak ? 6 : (v > 0 ? 2 : 0));
    ds0.pointBackgroundColor = dView.viewDaily.map((v, i) => i === dView.viewPeak ? '#ffab40' : '#ff5c5c');
    ds0.pointBorderColor     = dView.viewDaily.map((v, i) => i === dView.viewPeak ? '#fff'    : '#ff5c5c');
    ds0.pointBorderWidth     = dView.viewDaily.map((v, i) => i === dView.viewPeak ? 2         : 0);
  }
  ds0.hidden = false;

  // Dataset 1 — credit line, only visible in 'both' mode
  const ds1 = charts.cumul.data.datasets[1];
  if (isBoth) {
    ds1.data = cView.viewCumul;
    ds1.borderColor = '#00c896'; ds1.backgroundColor = 'rgba(0,200,150,0.1)';
    ds1.pointRadius          = cView.viewDaily.map((v, i) => i === cView.viewPeak ? 6 : (v > 0 ? 2 : 0));
    ds1.pointBackgroundColor = cView.viewDaily.map((v, i) => i === cView.viewPeak ? '#ffab40' : '#00c896');
    ds1.pointBorderColor     = cView.viewDaily.map((v, i) => i === cView.viewPeak ? '#fff'    : '#00c896');
    ds1.pointBorderWidth     = cView.viewDaily.map((v, i) => i === cView.viewPeak ? 2         : 0);
    ds1.hidden = false;
  } else {
    ds1.data = []; ds1.hidden = true;
  }

  charts.cumul.update();
  if (cumulState.crossCtx) cumulState.crossCtx.clearRect(0, 0, cumulState.crossCW, cumulState.crossCH);

  const sub = document.getElementById('cumulSub');
  if (sub) {
    const rangeStr = range === 'all' ? ' from day 1'
      : ` — last ${range === '1w' ? '7' : range === '2w' ? '14' : '30'} days`;
    if (isBoth) {
      sub.textContent = 'Debit vs Credit — cumulative running totals' + rangeStr;
    } else if (isDebit) {
      sub.textContent = 'Running total of debits' + (range === 'all' ? ' from day 1 — steeper slope = faster burn rate' : rangeStr);
    } else {
      sub.textContent = 'Running total of credits received' + rangeStr;
    }
  }

  applyCumulToggleStyle(mode);
  applyCumulRangeStyle(range);
}

window.setCumulMode  = function(mode)  { if (cumulState) updateCumul(mode,  cumulState.range); };
window.setCumulRange = function(range) { if (cumulState) updateCumul(cumulState.mode, range); };

function drawCumulCrosshair(ctx, chart, snapX, snapY, dataIndex, yVal) {
  if (!cumulState?.viewDays) return;
  const { left, right, top, bottom } = chart.chartArea;
  const d      = cumulState.viewDays[dataIndex];
  const isBoth = cumulState.mode === 'both';

  ctx.save();

  // ── Vertical hair (always) ─────────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth   = 1; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(snapX, top); ctx.lineTo(snapX, bottom); ctx.stroke();

  if (isBoth) {
    // ── Both mode: two dots, three-row label ──────────────────────────────────
    const dVal  = cumulState.viewCumulD[dataIndex] ?? 0;
    const cVal  = cumulState.viewCumulC[dataIndex] ?? 0;
    const dAmt  = cumulState.viewDailyD[dataIndex] ?? 0;
    const cAmt  = cumulState.viewDailyC[dataIndex] ?? 0;
    const dSnapY = chart.scales.y.getPixelForValue(dVal);
    const cSnapY = chart.scales.y.getPixelForValue(cVal);

    // Debit dot
    ctx.beginPath(); ctx.arc(snapX, dSnapY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ff5c5c'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.lineWidth = 1.5; ctx.stroke();

    // Credit dot
    ctx.beginPath(); ctx.arc(snapX, cSnapY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#00c896'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.lineWidth = 1.5; ctx.stroke();

    const dateStr = d ? d.getDate() + '/' + (d.getMonth() + 1) : '';
    const rowD = INR0(dVal) + '  |  +' + INR0(dAmt) + ' spent';
    const rowC = INR0(cVal) + '  |  +' + INR0(cAmt) + ' received';

    ctx.font = '500 10px Inter, sans-serif';
    const twD = ctx.measureText(rowD).width;
    const twC = ctx.measureText(rowC).width;
    ctx.font = '600 10px Inter, sans-serif';
    const twDate = ctx.measureText(dateStr).width;

    const pad = 8, lh = 65, lw = Math.max(twDate, twD + 14, twC + 14) + pad * 2;
    let lx = snapX - lw / 2;
    lx = Math.max(left, Math.min(lx, right - lw));
    const ly = top + 4;

    ctx.fillStyle = 'rgba(18,18,28,0.92)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(lx, ly, lw, lh, 4); ctx.fill(); }
    else { ctx.fillRect(lx, ly, lw, lh); }

    // Row 0 — date
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillStyle = '#9090b8'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(dateStr, lx + pad, ly + 11);

    // Row 1 — debit (red bar + text)
    ctx.fillStyle = '#ff5c5c';
    ctx.fillRect(lx + pad, ly + 26, 8, 2);
    ctx.font = '500 10px Inter, sans-serif'; ctx.fillStyle = '#e2e2f0';
    ctx.fillText(rowD, lx + pad + 12, ly + 27);

    // Row 2 — credit (green bar + text)
    ctx.fillStyle = '#00c896';
    ctx.fillRect(lx + pad, ly + 44, 8, 2);
    ctx.fillStyle = '#e2e2f0';
    ctx.fillText(rowC, lx + pad + 12, ly + 45);

    // Y-axis tick for debit value
    const dTick = dVal >= 1000 ? '₹' + (dVal / 1000).toFixed(1).replace(/\.0$/, '') + 'K' : INR0(dVal);
    ctx.font = '500 10px JetBrains Mono, monospace';
    const yw = ctx.measureText(dTick).width + 8, yh = 16, yx = left - yw - 3;
    if (yx >= 0) {
      ctx.fillStyle = 'rgba(18,18,28,0.92)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(yx, dSnapY - yh / 2, yw, yh, 3); ctx.fill(); }
      else { ctx.fillRect(yx, dSnapY - yh / 2, yw, yh); }
      ctx.fillStyle = '#ff5c5c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dTick, yx + yw / 2, dSnapY);
    }

  } else {
    // ── Single mode: horizontal hair + dot + two-line label ───────────────────
    const dotColor = cumulState.mode === 'debit' ? '#ff5c5c' : '#00c896';

    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(left, snapY); ctx.lineTo(right, snapY); ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath(); ctx.arc(snapX, snapY, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = dotColor; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.88)'; ctx.lineWidth = 1.5; ctx.stroke();

    const amtStr  = INR0(yVal);
    const dateStr = d ? d.getDate() + '/' + (d.getMonth() + 1) : '';
    const dayAmt  = cumulState.viewDaily[dataIndex] ?? 0;
    const dayWord = cumulState.mode === 'debit' ? 'spent today' : 'received today';
    const line1   = amtStr + '  |  ' + dateStr;
    const line2   = '+' + INR0(dayAmt) + ' ' + dayWord;

    ctx.font = '600 11px Inter, sans-serif';
    const tw1 = ctx.measureText(line1).width;
    ctx.font = '400 10px Inter, sans-serif';
    const tw2 = ctx.measureText(line2).width;

    const pad = 8, lh = 33, lw = Math.max(tw1, tw2) + pad * 2;
    let lx = snapX - lw / 2;
    lx = Math.max(left, Math.min(lx, right - lw));
    const ly = top + 4;

    ctx.fillStyle = 'rgba(18,18,28,0.92)';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(lx, ly, lw, lh, 4); ctx.fill(); }
    else { ctx.fillRect(lx, ly, lw, lh); }

    ctx.font = '600 11px Inter, sans-serif'; ctx.fillStyle = '#e2e2f0';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(line1, lx + pad, ly + 11);
    ctx.font = '400 10px Inter, sans-serif'; ctx.fillStyle = '#7878a0';
    ctx.fillText(line2, lx + pad, ly + 24);

    const yTick = yVal >= 1000
      ? '₹' + (yVal / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
      : INR0(yVal);
    ctx.font = '500 10px JetBrains Mono, monospace';
    const yw = ctx.measureText(yTick).width + 8, yh = 16, yx = left - yw - 3;
    if (yx >= 0) {
      ctx.fillStyle = 'rgba(18,18,28,0.92)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(yx, snapY - yh / 2, yw, yh, 3); ctx.fill(); }
      else { ctx.fillRect(yx, snapY - yh / 2, yw, yh); }
      ctx.fillStyle = '#9090b8'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(yTick, yx + yw / 2, snapY);
    }
  }

  ctx.restore();
}

function downloadExcel() {
  if (!allTxns.length) return;
  if (typeof XLSX === 'undefined') { alert('XLSX library not loaded — check your internet connection and reload.'); return; }

  const wb   = XLSX.utils.book_new();
  const WKDY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const src  = appSource === 'gpay' ? 'Google Pay' : 'PhonePe';
  const dbts = allTxns.filter(t => t.type === 'Debit');
  const crds = allTxns.filter(t => t.type === 'Credit');
  const totD = dbts.reduce((s, t) => s + t.amount, 0);

  const validDates = allTxns.map(t => t.dateObj).filter(d => d && !isNaN(+d));
  const d0 = validDates.length ? validDates.reduce((a, b) => +a < +b ? a : b) : new Date();
  const d1 = validDates.length ? validDates.reduce((a, b) => +a > +b ? a : b) : new Date();
  const fmtD = d => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  // ── Helpers ──────────────────────────────────────────────────────────────
  // Freeze the first row of a worksheet
  const freeze1 = ws => {
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };
  };

  // Set Excel number-format string on a column of cells (0-indexed col, 1-indexed rows)
  const fmtCol = (ws, col, rowStart, rowEnd, z) => {
    for (let r = rowStart; r <= rowEnd; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: col });
      if (ws[ref]) ws[ref].z = z;
    }
  };

  // Auto-size columns from content (max char width per column, capped)
  const autoW = (data, cap = 48) => {
    const ncols = data.reduce((m, r) => Math.max(m, r.length), 0);
    const w = Array(ncols).fill(8);
    data.forEach(row => row.forEach((v, i) => {
      const l = String(v == null ? '' : v).length;
      if (l + 2 > w[i]) w[i] = Math.min(l + 2, cap);
    }));
    return w.map(n => ({ wch: n }));
  };

  const CURR = '#,##0.00';
  const PCT  = '0.0%';

  // ── Sheet 1 — All Transactions ──────────────────────────────────────────
  const s1 = [
    ['DATE', 'DAY OF WEEK', 'TIME', 'MERCHANT / DESCRIPTION', 'CATEGORY', 'TYPE', 'AMOUNT (₹)', 'SOURCE'],
    ...allTxns.map(t => [
      t.date,
      (t.dateObj && !isNaN(+t.dateObj)) ? WKDY[t.dateObj.getDay()] : '',
      t.time,
      t.name,
      t.category,
      t.type,
      t.amount,
      src
    ])
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1['!cols'] = autoW(s1);
  fmtCol(ws1, 6, 1, s1.length - 1, CURR);
  freeze1(ws1);
  XLSX.utils.book_append_sheet(wb, ws1, 'Transactions');

  // ── Sheet 2 — Monthly Summary ────────────────────────────────────────────
  const monMap = {};
  allTxns.forEach(t => {
    if (!t.dateObj || isNaN(+t.dateObj)) return;
    const key = t.dateObj.getFullYear() + '-' + String(t.dateObj.getMonth() + 1).padStart(2, '0');
    if (!monMap[key]) monMap[key] = {
      label: t.dateObj.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      dbts: [], crds: []
    };
    (t.type === 'Debit' ? monMap[key].dbts : monMap[key].crds).push(t);
  });

  const s2 = [
    ['MONTH', 'TOTAL SPENT (₹)', 'TOTAL RECEIVED (₹)', 'NET FLOW (₹)', 'TXN COUNT', 'AVG TXN SIZE (₹)', 'LARGEST SPEND (₹)', 'TOP 3 MERCHANTS'],
    ...Object.entries(monMap).sort(([a],[b]) => a.localeCompare(b)).map(([, m]) => {
      const spent = m.dbts.reduce((s, t) => s + t.amount, 0);
      const recv  = m.crds.reduce((s, t) => s + t.amount, 0);
      const avg   = m.dbts.length ? spent / m.dbts.length : 0;
      const big   = m.dbts.length ? m.dbts.reduce((x, t) => t.amount > x ? t.amount : x, 0) : 0;
      const vm = {};
      m.dbts.forEach(t => { vm[t.name] = (vm[t.name] || 0) + t.amount; });
      const top3 = Object.entries(vm).sort(([,a],[,b]) => b-a).slice(0, 3).map(([n]) => n).join(' · ');
      return [m.label, spent, recv, recv - spent, m.dbts.length + m.crds.length, avg, big, top3];
    })
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(s2);
  ws2['!cols'] = autoW(s2);
  [1,2,3,5,6].forEach(c => fmtCol(ws2, c, 1, s2.length - 1, CURR));
  freeze1(ws2);
  XLSX.utils.book_append_sheet(wb, ws2, 'Monthly Summary');

  // ── Sheet 3 — Category Breakdown ─────────────────────────────────────────
  const catStats = {};
  dbts.forEach(t => {
    if (!catStats[t.category]) catStats[t.category] = { txns: [], ven: {} };
    catStats[t.category].txns.push(t);
    catStats[t.category].ven[t.name] = (catStats[t.category].ven[t.name] || 0) + 1;
  });

  const s3 = [
    ['CATEGORY', 'TOTAL SPENT (₹)', '% OF TOTAL', 'TXN COUNT', 'AVG SPEND (₹)', 'MIN (₹)', 'MAX (₹)', 'TOP MERCHANT'],
    ...Object.entries(catStats)
      .sort(([,a],[,b]) => b.txns.reduce((s,t)=>s+t.amount,0) - a.txns.reduce((s,t)=>s+t.amount,0))
      .map(([cat, { txns, ven }]) => {
        const tot  = txns.reduce((s, t) => s + t.amount, 0);
        const amts = txns.map(t => t.amount);
        const mn   = amts.reduce((a,b) => a < b ? a : b);
        const mx   = amts.reduce((a,b) => a > b ? a : b);
        const topV = Object.entries(ven).sort(([,a],[,b]) => b-a)[0]?.[0] || '';
        return [cat, tot, totD ? tot / totD : 0, txns.length, tot / txns.length, mn, mx, topV];
      })
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(s3);
  ws3['!cols'] = autoW(s3);
  [1,4,5,6].forEach(c => fmtCol(ws3, c, 1, s3.length - 1, CURR));
  fmtCol(ws3, 2, 1, s3.length - 1, PCT);
  freeze1(ws3);
  XLSX.utils.book_append_sheet(wb, ws3, 'Categories');

  // ── Sheet 4 — Daily Spend (every calendar day in range) ──────────────────
  const dayDb = {}, dayCr = {}, dayCt = {};
  allTxns.forEach(t => {
    const k = toIso(t.dateObj);
    if (!k) return;
    if (t.type === 'Debit')  dayDb[k] = (dayDb[k] || 0) + t.amount;
    else                     dayCr[k] = (dayCr[k] || 0) + t.amount;
    dayCt[k] = (dayCt[k] || 0) + 1;
  });

  let cumul = 0;
  const s4rows = [];
  const s4start = new Date(d0); s4start.setHours(0,0,0,0);
  const s4end   = new Date(d1); s4end.setHours(0,0,0,0);
  for (let cur = new Date(s4start); +cur <= +s4end; cur.setDate(cur.getDate() + 1)) {
    const k = toIso(cur);
    const db = dayDb[k] || 0;
    cumul += db;
    s4rows.push([
      fmtD(cur),
      WKDY[cur.getDay()],
      db,
      dayCr[k] || 0,
      dayCt[k] || 0,
      cumul
    ]);
  }
  const s4 = [['DATE', 'DAY OF WEEK', 'TOTAL DEBITS (₹)', 'TOTAL CREDITS (₹)', 'TXN COUNT', 'CUMULATIVE SPEND (₹)'], ...s4rows];
  const ws4 = XLSX.utils.aoa_to_sheet(s4);
  ws4['!cols'] = autoW(s4);
  [2,3,5].forEach(c => fmtCol(ws4, c, 1, s4.length - 1, CURR));
  freeze1(ws4);
  XLSX.utils.book_append_sheet(wb, ws4, 'Daily Spend');

  // ── Sheet 5 — Merchant Analysis ───────────────────────────────────────────
  const venStats = {};
  dbts.forEach(t => {
    const key = t.name.toUpperCase().trim();
    if (!venStats[key]) venStats[key] = { name: t.name, txns: [] };
    venStats[key].txns.push(t);
  });

  const monthsSpanned = Math.max(1,
    (d1.getFullYear() - d0.getFullYear()) * 12 + (d1.getMonth() - d0.getMonth()) + 1
  );

  const s5 = [
    ['MERCHANT', 'TOTAL SPEND (₹)', 'TXN COUNT', 'AVG PER VISIT (₹)', 'FIRST TXN', 'LAST TXN', 'ACTIVE DAYS', 'FREQ (TXN/MONTH)'],
    ...Object.values(venStats)
      .sort((a, b) => b.txns.reduce((s,t)=>s+t.amount,0) - a.txns.reduce((s,t)=>s+t.amount,0))
      .map(({ name, txns }) => {
        const tot  = txns.reduce((s, t) => s + t.amount, 0);
        const vd   = txns.map(t => t.dateObj).filter(d => d && !isNaN(+d));
        const frst = vd.length ? fmtD(vd.reduce((a,b) => +a < +b ? a : b)) : '';
        const last = vd.length ? fmtD(vd.reduce((a,b) => +a > +b ? a : b)) : '';
        const days = new Set(txns.map(t => toIso(t.dateObj)).filter(Boolean)).size;
        return [name, tot, txns.length, tot / txns.length, frst, last, days, +(txns.length / monthsSpanned).toFixed(1)];
      })
  ];
  const ws5 = XLSX.utils.aoa_to_sheet(s5);
  ws5['!cols'] = autoW(s5);
  [1,3].forEach(c => fmtCol(ws5, c, 1, s5.length - 1, CURR));
  fmtCol(ws5, 7, 1, s5.length - 1, '0.0');
  freeze1(ws5);
  XLSX.utils.book_append_sheet(wb, ws5, 'Merchants');

  // ── Filename ─────────────────────────────────────────────────────────────
  const toMY = d => d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }).replace(' ', '_');
  const startMY = toMY(d0), endMY = toMY(d1);
  XLSX.writeFile(wb, startMY === endMY
    ? `SpendLens_Report_${startMY}.xlsx`
    : `SpendLens_Report_${startMY}_to_${endMY}.xlsx`
  );
}

function renderTxnTable(txns, filter) {
  activeFilter = filter;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.textContent === filter));
  const filtered = filter === 'All' ? txns : txns.filter(t => (t.type === 'Credit' ? 'Income / received' : t.category) === filter);
  document.getElementById('txnBody').innerHTML = filtered.map(t => {
    const cat = t.type === 'Credit' ? 'Income / received' : t.category;
    const col = catColor(cat);
    return `<tr>
      <td style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#ececf1;white-space:nowrap;">${t.date}<br>${t.time}</td>
      <td style="font-weight:500;max-width:200px;">${escHtml(t.name)}</td>
      <td><span class="cat-tag" style="background:${cat === 'Income / received' ? '#1a3a2a' : '#2d2d52'};color:${cat === 'Income / received' ? '#4ade80' : '#a5b4fc'};">${cat}</span></td>
      <td><span class="pill ${t.type === 'Debit' ? 'pill-debit' : 'pill-credit'}">${t.type}</span></td>
      <td class="${t.type === 'Debit' ? 'amt-debit' : 'amt-credit'}">${INR2(t.amount)}</td>
    </tr>`;
  }).join('');
}
window.filterTxns = cat => renderTxnTable(allTxns, cat);

function genInsights(debits, credits, catMap, venMap, total) {
  const ins  = [];
  const loan = catMap['Loans & EMIs'] || 0;
  const food = catMap['Food & dining'] || 0;
  const fuel = catMap['Fuel & vehicle'] || 0;
  const groc = catMap['Groceries'] || 0;
  const topV = Object.values(venMap).sort((a, b) => b.count - a.count)[0];
  const night = debits.filter(t => { const h = t.dateObj?.getHours(); return h >= 22 || h <= 5; });
  if (loan > total * 0.25) ins.push({ type: 'alert', icon: '⚡', title: 'Heavy loan burden', body: `EMIs are ${INR0(loan)} — ${Math.round(loan / total * 100)}% of outflow. Prepaying the smallest loan can free up significant cash.` });
  if (food > 0) ins.push({ type: 'good', icon: '🍽️', title: 'Food tracked', body: `${INR0(food)} across ${debits.filter(t => t.category === 'Food & dining').length} meals — avg ${INR0(Math.round(food / Math.max(1, debits.filter(t => t.category === 'Food & dining').length)))} per transaction.` });
  if (fuel > 0) ins.push({ type: 'warn', icon: '⛽', title: 'Fuel costs', body: `${INR0(fuel)} on fuel. Metro or carpooling could reduce this significantly.` });
  if (topV) ins.push({ type: 'good', icon: '🔁', title: 'Top vendor', body: `${escHtml(topV.name)} — visited ${topV.count}×, spending ${INR0(topV.total)} total.` });
  if (night.length > 3) ins.push({ type: 'warn', icon: '🌙', title: 'Late-night spending', body: `${night.length} transactions after 10 PM or before 6 AM totalling ${INR0(night.reduce((s, t) => s + t.amount, 0))}. Impulse risk.` });
  if (credits.length > 0) ins.push({ type: 'good', icon: '💰', title: `${credits.length} credits received`, body: `Total received: ${INR0(credits.reduce((s, t) => s + t.amount, 0))} from ${credits.length} transactions.` });
  if (groc > 500) ins.push({ type: 'warn', icon: '🛒', title: 'Quick commerce habit', body: `${INR0(groc)} on quick delivery. Bulk shopping saves 30–40%.` });
  return ins;
}

function detectAnomalies(debits, dayMap, venMap) {
  const out  = [];
  const mean = debits.reduce((s, t) => s + t.amount, 0) / debits.length;
  [...debits].sort((a, b) => b.amount - a.amount).slice(0, 5).forEach(t => {
    if (t.amount > mean * 2) out.push({ level: 'high', title: `Large payment: ${INR0(t.amount)} to ${escHtml(t.name)}`, desc: `${Math.round(t.amount / mean)}× your average transaction — verify this was intentional.` });
  });
  debits.filter(t => { const h = t.dateObj?.getHours(); return h >= 0 && h <= 5; }).forEach(t => {
    if (t.amount > 1000) out.push({ level: 'med', title: `Odd-hour payment: ${INR0(t.amount)} at ${t.time}`, desc: `To ${escHtml(t.name)}. Late-night large payments warrant review.` });
  });
  const avgDay = Object.values(dayMap).reduce((s, v) => s + v, 0) / Object.values(dayMap).length;
  Object.entries(dayMap).forEach(([day, amt]) => {
    if (amt > avgDay * 2) out.push({ level: 'med', title: `High spend day ${day}: ${INR0(amt)}`, desc: `${Math.round(amt / avgDay)}× the daily average.` });
  });
  return out.slice(0, 8);
}

function calcScore(catMap, debits, total, net) {
  let s = 60;
  const lr = (catMap['Loans & EMIs'] || 0) / total;
  if (lr > 0.4) s -= 20; else if (lr > 0.25) s -= 10;
  if (net > 0) s += 15; else if (net < -20000) s -= 15;
  if (debits.filter(t => { const h = t.dateObj?.getHours(); return h >= 0 && h <= 5; }).length > 5) s -= 8;
  if ((catMap['Groceries'] || 0) / total < 0.05) s += 5;
  return Math.min(100, Math.max(10, s));
}

function verdictDesc(score, catMap, total, net) {
  // BUG 4 fix: total === 0 (credit-only statement) produces NaN% without this guard
  const lp = total ? Math.round((catMap['Loans & EMIs'] || 0) / total * 100) : 0;
  if (score >= 70) return 'Spending is well controlled. Daily expenses are modest and the period shows positive or neutral flow. Keep this discipline and focus on building savings.';
  if (score >= 45) return `Day-to-day spending is reasonable but fixed obligations (EMIs: ${lp}% of outflow${net < 0 ? ', net outflow negative' : ''}) leave limited breathing room. Reducing loan count is the highest-leverage action.`;
  return `Significant financial pressure — high loan ratio (${lp}%) and net outflow are straining your finances. Prioritize clearing one loan, cut discretionary spend, and build an emergency buffer.`;
}

// ── Smart Summary (rule-based) ──
function genSmartSummary(debits, credits, catMap, dayMap, topVen, totalD, totalC, net, d0, d1) {
  const lines = [];
  const days  = Object.keys(dayMap);
  const avgDay = days.length ? days.reduce((s, d) => s + dayMap[d], 0) / days.length : 0;

  // Top spending category
  const topCat = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];
  if (topCat) {
    const n = debits.filter(t => t.category === topCat[0]).length;
    lines.push(`You spent the most on <strong>${topCat[0]}</strong> this period — ${INR0(topCat[1])} across ${n} transaction${n !== 1 ? 's' : ''}.`);
  }

  // Peak spend day
  if (days.length) {
    const peak = days.reduce((a, b) => dayMap[a] > dayMap[b] ? a : b);
    lines.push(`<strong>${peak}</strong> was your highest spend day at ${INR0(dayMap[peak])}.`);
  }

  // Days above average
  if (avgDay > 0) {
    const above = days.filter(d => dayMap[d] > avgDay).length;
    lines.push(`Average daily spend was ${INR0(Math.round(avgDay))}. You exceeded that on <strong>${above}</strong> of ${days.length} day${days.length !== 1 ? 's' : ''}.`);
  }

  // Top vendor
  if (topVen.length) {
    const v = topVen[0];
    lines.push(`<strong>${escHtml(v.name)}</strong> was your most frequent payee — ${v.count} payment${v.count !== 1 ? 's' : ''} totalling ${INR0(v.total)}.`);
  }

  // Net flow
  if (net >= 0) {
    lines.push(`You received more than you spent. Net surplus: <strong>${INR0(net)}</strong>.`);
  } else {
    lines.push(`Outflow exceeded income by <strong>${INR0(Math.abs(net))}</strong> this period.`);
  }

  // EMI burden (conditional)
  const emi = catMap['Loans & EMIs'] || 0;
  if (emi > 0 && totalD > 0) {
    const pct = Math.round(emi / totalD * 100);
    lines.push(`Loans & EMIs consumed <strong>${pct}%</strong> of your outflow — ${INR0(emi)}.`);
  }

  // Late-night transactions (conditional)
  const night = debits.filter(t => { const h = t.dateObj?.getHours(); return h >= 22 || h <= 5; });
  if (night.length > 0) {
    const nightTotal = night.reduce((s, t) => s + t.amount, 0);
    lines.push(`<strong>${night.length}</strong> transaction${night.length !== 1 ? 's' : ''} happened after 10 PM or before 6 AM, totalling ${INR0(nightTotal)}.`);
  }

  // Transaction average
  if (debits.length > 0) {
    const avgTxn = Math.round(totalD / debits.length);
    lines.push(`${debits.length} debit transaction${debits.length !== 1 ? 's' : ''} this period, averaging <strong>${INR0(avgTxn)}</strong> each.`);
  }

  return lines;
}

// ── File handling ──
async function handleFile(file) {
  if (!file || file.type !== 'application/pdf') { alert('Please upload a PDF file.'); return; }
  document.getElementById('upload-screen').style.display = 'none';
  const ls = document.getElementById('loading-screen');
  ls.style.display = 'flex';

  try {
    document.getElementById('loaderText').textContent = 'Reading PDF...';
    await new Promise(r => setTimeout(r, 200));
    document.getElementById('loaderText').textContent = 'Parsing transactions...';
    const txns = await parsePDF(file);
    if (txns.length === 0) {
      throw new Error('No transactions found in this PDF.\n\nOpen DevTools (F12 → Console) and look for "[SpendLens] Extracted PDF text" to see what was read.');
    }
    document.getElementById('loaderText').textContent = 'Building dashboard...';
    await new Promise(r => setTimeout(r, 200));
    allTxns = txns;
    saveSession(); // persist immediately so a refresh restores this dashboard
    ls.style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    renderDashboard(txns);
    window.scrollTo(0, 0);
  } catch(e) {
    ls.style.display = 'none';
    document.getElementById('upload-screen').style.display = 'flex';
    if (e.message !== '__cancelled__') { alert(e.message); console.error(e); }
  }
}

// ── Events ──
const dropZone  = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', function(e) {
  e.stopPropagation();
  fileInput.click();
});
fileInput.addEventListener('change', function(e) {
  if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
});
dropZone.addEventListener('dragover',  function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', function(e) { e.preventDefault(); dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('drop', function(e) {
  e.preventDefault(); e.stopPropagation();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

// On every page load (including F5 refresh), attempt to restore the last session.
// hydrateSession() is called after all DOM listeners are registered so renderDashboard
// can safely wire up chart events and interactive elements.
hydrateSession();

// ── Preview section: dummy charts rendered on landing page ────────────────
(function initPreviewCharts() {
  const donutEl = document.getElementById('previewDonut');
  const lineEl  = document.getElementById('previewLine');
  if (!donutEl || !lineEl || typeof Chart === 'undefined') return;

  new Chart(donutEl, {
    type: 'doughnut',
    data: {
      labels: ['Food & Dining', 'Fuel', 'Bills', 'Transport', 'Groceries'],
      datasets: [{
        data: [4820, 3200, 2100, 1840, 1560],
        backgroundColor: ['#ff5c5c', '#ffab40', '#4d9fff', '#00c896', '#a29bfe'],
        borderWidth: 0, hoverOffset: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '66%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: false
    }
  });

  const daily = [96, 1240, 349, 2800, 520, 210, 4200, 680, 349, 1560, 2100, 440, 3200, 520, 890, 210, 1100, 640, 349, 820];
  let run = 0;
  const cumul = daily.map(v => { const p = run; run += v; return p; });

  new Chart(lineEl, {
    type: 'line',
    data: {
      labels: daily.map((_, i) => i + 1),
      datasets: [{
        data: cumul,
        borderColor: '#ff5c5c', backgroundColor: 'rgba(255,92,92,0.07)',
        borderWidth: 1.5, fill: true, tension: 0.4, pointRadius: 0
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, min: 0 } },
      animation: false
    }
  });
})();
