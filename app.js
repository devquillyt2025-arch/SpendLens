// OPENAI_KEY is loaded from config.js

if (typeof pdfjsLib === 'undefined' || typeof Chart === 'undefined') {
  document.body.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem;font-family:monospace;color:#ff5c5c;background:#08080d;padding:2rem;text-align:center;"><div style="font-size:1.5rem;">⚠ Failed to load libraries</div><div style="color:#8888a0;font-size:13px;">PDF.js or Chart.js did not load. Check your internet connection and reload the page.</div></div>';
  throw new Error('Libraries not loaded');
}
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const INR0 = n => n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const INR2 = n => n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });

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

  loadingTask.onPassword = async (updatePassword, reason) => {
    try {
      const pwd = await showPasswordModal(reason);
      updatePassword(pwd);
    } catch {
      loadingTask.destroy();
    }
  };

  const pdf = await loadingTask.promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const c = await p.getTextContent();
    text += c.items.map(x => x.str).join(' ') + '\n';
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

  const walPat = /(\w+ \d{1,2}, \d{4}) (\d{1,2}:\d{2} [AP]M) (Money added[^D]+?) Debit INR ([\d,]+\.?\d*)/g;
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
  if (!dm) return new Date();
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
let allTxns = [], activeFilter = 'All', charts = {}, appSource = '';

function resetApp() {
  allTxns = [];
  appSource = '';
  Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
  charts = {};
  document.getElementById('upload-screen').style.display = 'flex';
  document.getElementById('dashboard').style.display = 'none';
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
  const d0      = dates.length ? new Date(Math.min(...dates)) : new Date();
  const d1      = dates.length ? new Date(Math.max(...dates)) : new Date();
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
        <div style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.name}</div>
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
      <span class="v-name">${v.name.slice(0, 22)}</span>
      <span class="v-count">${v.count}×</span>
      <span class="v-amt">${INR0(v.total)}</span>
    </div>`).join('');

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

  // AI analysis
  if (typeof OPENAI_KEY !== 'undefined' && OPENAI_KEY && OPENAI_KEY !== 'YOUR_OPENAI_KEY_HERE') {
    runAIAnalysis(OPENAI_KEY, { debits, credits, totalD, totalC, net, catMap, topVen, anomalies, score, d0, d1 });
  }
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
      <td style="font-weight:500;max-width:200px;">${t.name}</td>
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
  if (topV) ins.push({ type: 'good', icon: '🔁', title: 'Top vendor', body: `${topV.name} — visited ${topV.count}×, spending ${INR0(topV.total)} total.` });
  if (night.length > 3) ins.push({ type: 'warn', icon: '🌙', title: 'Late-night spending', body: `${night.length} transactions after 10 PM or before 6 AM totalling ${INR0(night.reduce((s, t) => s + t.amount, 0))}. Impulse risk.` });
  if (credits.length > 0) ins.push({ type: 'good', icon: '💰', title: `${credits.length} credits received`, body: `Total received: ${INR0(credits.reduce((s, t) => s + t.amount, 0))} from ${credits.length} transactions.` });
  if (groc > 500) ins.push({ type: 'warn', icon: '🛒', title: 'Quick commerce habit', body: `${INR0(groc)} on quick delivery. Bulk shopping saves 30–40%.` });
  return ins;
}

function detectAnomalies(debits, dayMap, venMap) {
  const out  = [];
  const mean = debits.reduce((s, t) => s + t.amount, 0) / debits.length;
  [...debits].sort((a, b) => b.amount - a.amount).slice(0, 3).forEach(t => {
    if (t.amount > mean * 8) out.push({ level: 'high', title: `Large payment: ${INR0(t.amount)} to ${t.name}`, desc: `${Math.round(t.amount / mean)}× your average — verify this was intentional.` });
  });
  debits.filter(t => { const h = t.dateObj?.getHours(); return h >= 0 && h <= 5; }).forEach(t => {
    if (t.amount > 1000) out.push({ level: 'med', title: `Odd-hour payment: ${INR0(t.amount)} at ${t.time}`, desc: `To ${t.name}. Late-night large payments warrant review.` });
  });
  const avgDay = Object.values(dayMap).reduce((s, v) => s + v, 0) / Object.values(dayMap).length;
  Object.entries(dayMap).forEach(([day, amt]) => {
    if (amt > avgDay * 5 && amt > 10000) out.push({ level: 'med', title: `Spending spike ${day}: ${INR0(amt)}`, desc: `${Math.round(amt / avgDay)}× the daily average.` });
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
  const lp = Math.round((catMap['Loans & EMIs'] || 0) / total * 100);
  if (score >= 70) return 'Spending is well controlled. Daily expenses are modest and the period shows positive or neutral flow. Keep this discipline and focus on building savings.';
  if (score >= 45) return `Day-to-day spending is reasonable but fixed obligations (EMIs: ${lp}% of outflow${net < 0 ? ', net outflow negative' : ''}) leave limited breathing room. Reducing loan count is the highest-leverage action.`;
  return `Significant financial pressure — high loan ratio (${lp}%) and net outflow are straining your finances. Prioritize clearing one loan, cut discretionary spend, and build an emergency buffer.`;
}

// ── OpenAI Analysis ──
async function runAIAnalysis(apiKey, data) {
  const { debits, credits, totalD, totalC, net, catMap, topVen, anomalies, score, d0, d1 } = data;
  const fmt = INR0;
  const catSummary    = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([k, v]) => `${k}: ${fmt(v)} (${Math.round(v / totalD * 100)}%)`).join(', ');
  const vendorSummary = topVen.slice(0, 5).map(v => `${v.name} (${v.count}×, ${fmt(v.total)})`).join(', ');

  const prompt = `You are a sharp, empathetic personal finance coach. Analyze this spending data and give 4–5 concise, actionable insights. Be specific with numbers. Use **bold** for key figures. Tone: friendly but direct.

Period: ${d0.toLocaleDateString('en-IN')} to ${d1.toLocaleDateString('en-IN')}
Total spent: ${fmt(totalD)} across ${debits.length} debit transactions
Total received: ${fmt(totalC)} across ${credits.length} credit transactions
Net flow: ${net >= 0 ? '+' : '-'}${fmt(Math.abs(net))}
Health score: ${score}/100

Top spending categories: ${catSummary}
Frequent vendors: ${vendorSummary}
${anomalies.length ? 'Anomalies detected: ' + anomalies.map(a => a.title).join('; ') : 'No major anomalies.'}

Give exactly 4–5 insights, each 2–3 sentences. Start each with a clear heading on its own line followed by the detail. No preamble, no closing summary.`;

  const aiLoading = document.getElementById('aiLoading');
  const aiText    = document.getElementById('aiText');
  aiLoading.style.display = 'flex';
  aiText.innerHTML = '';

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], max_tokens: 700, temperature: 0.7, stream: true })
    });
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API error'); }

    aiLoading.style.display = 'none';
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value).split('\n')) {
        const l = line.trim();
        if (!l || l === 'data: [DONE]') continue;
        if (l.startsWith('data: ')) {
          try { const d = JSON.parse(l.slice(6)); raw += d.choices?.[0]?.delta?.content || ''; aiText.innerHTML = formatAI(raw); } catch(e) {}
        }
      }
    }
    aiText.innerHTML = formatAI(raw);
  } catch(e) {
    aiLoading.style.display = 'none';
    aiText.innerHTML = `<span style="color:var(--red);">AI analysis failed: ${e.message}</span><br><span style="color:var(--t3);font-size:11px;">Check your API key in config.js and reload.</span>`;
  }
}

function formatAI(text) {
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
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
