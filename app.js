'use strict';

/* =========================================================================
   داده‌های پایه (نمونه / Mock) — نقاط اتصال داده واقعی با TODO مشخص شده‌اند
   ========================================================================= */

// TODO(اتصال واقعی): هر exchange یک fetcher واقعی می‌گیرد.
// نمونه Nobitex (تایید شده، مستندات رسمی apidocs.nobitex.ir):
//   GET https://apiv2.nobitex.ir/v3/orderbook/BTCIRT   → بهترین قیمت خرید/فروش
//   POST https://apiv2.nobitex.ir/market/stats {srcCurrency,dstCurrency}
// نمونه Wallex (مستندات api-docs.wallex.ir):
//   GET https://api.wallex.ir/v1/markets   → لیست همه بازارها با قیمت لحظه‌ای
// هر دو API عمومی‌اند و کلید لازم ندارند، اما ممکن است نیاز به IP ایران داشته باشند
// و فراخوانی مستقیم از مرورگر گاهی با CORS بلاک می‌شود — در آن صورت باید از یک
// پراکسی سبک (مثلاً یک Cloudflare Worker کوچک) رد شوند.
const EXCHANGES = [
  { id: 'nobitex',  name: 'نوبیتکس',  feePct: 0.35 },
  { id: 'wallex',   name: 'والکس',    feePct: 0.30 },
  { id: 'bitpin',   name: 'بیت‌پین',  feePct: 0.35 },
  { id: 'tabdeal',  name: 'تبدیل',    feePct: 0.30 },
  { id: 'ramzinex', name: 'رمزینکس',  feePct: 0.40 },
];

// قیمت‌های پایه تقریبی (تومان) — فقط برای دمو؛ با API واقعی جایگزین شود
const COINS = [
  { id: 'USDT', name: 'تتر',      base: 180000 },
  { id: 'BTC',  name: 'بیت‌کوین', base: 11340000000 },
  { id: 'ETH',  name: 'اتریوم',   base: 620000000 },
  { id: 'TON',  name: 'تون‌کوین', base: 900000 },
  { id: 'DOGE', name: 'دوج‌کوین', base: 34000 },
  { id: 'TRX',  name: 'ترون',     base: 42000 },
];

// TODO(اتصال واقعی): برای طلا/سکه، منبع رایج tgju.org است. سایت API عمومی رسمی
// منتشر نکرده؛ برای گرفتن زنده باید یک بک‌اند کوچک بسازی که صفحه را بخواند
// (Scrape) و JSON برگرداند — از مرورگر مستقیم به دلیل CORS ممکن نیست.
const COIN_TYPES = {
  emami:   { label: 'سکه امامی',      weight: 8.133, purity: 0.9   },
  bahar:   { label: 'بهار آزادی',      weight: 8.133, purity: 0.9   },
  half:    { label: 'نیم سکه',        weight: 4.0665, purity: 0.9  },
  quarter: { label: 'ربع سکه',        weight: 2.033,  purity: 0.9  },
  gerami:  { label: 'سکه گرمی',       weight: 1,      purity: 0.9  },
  gram18:  { label: 'طلای ۱۸ عیار (هر گرم)', weight: 1, purity: 0.75 },
};

// TODO(اتصال واقعی): نمادها/NAV واقعی صندوق‌ها را از TSETMC یا fipiran.com بگیر.
// نمادهای زیر فقط نمونه‌اند و اعداد واقعی نیستند.
const FUNDS = [
  { symbol: 'عیار',  name: 'صندوق طلای عیار',      type: 'طلا',  nav: 9800,  market: 9450  },
  { symbol: 'گنج',   name: 'صندوق کالایی گنج',     type: 'کالا', nav: 15200, market: 15850 },
  { symbol: 'زر',    name: 'صندوق طلای زر',        type: 'طلا',  nav: 21300, market: 21100 },
  { symbol: 'نقره',  name: 'صندوق نقره',           type: 'نقره', nav: 7600,  market: 8200  },
];

/* =========================================================================
   وضعیت و تنظیمات (localStorage)
   ========================================================================= */

const DEFAULT_SETTINGS = {
  thArb: 1.0,
  thGold: 3.0,
  thFund: 4.0,
  minProfit: 0.3,
  capital: 0,
  riskLevel: 'medium',
  favoriteCoins: ['USDT','BTC','ETH','TON','DOGE','TRX'],
  alertTypes: { arb: true, gold: true, fund: true },
  gold: { ounce: 4100, usd: 180000, market: 0, coinType: 'emami' },
};

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function saveJSON(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON('bb_settings', DEFAULT_SETTINGS));
settings.gold = Object.assign({}, DEFAULT_SETTINGS.gold, settings.gold || {});
settings.alertTypes = Object.assign({}, DEFAULT_SETTINGS.alertTypes, settings.alertTypes || {});
if (!Array.isArray(settings.favoriteCoins)) settings.favoriteCoins = DEFAULT_SETTINGS.favoriteCoins.slice();

let history  = loadJSON('bb_history', []);
let portfolio = loadJSON('bb_portfolio', []);

/* =========================================================================
   موتور قیمت نمونه (شبیه‌سازی نوسان زنده)
   ========================================================================= */

function jitter(base, pctRange) {
  const p = (Math.random() * 2 - 1) * pctRange;
  return base * (1 + p / 100);
}

let priceSnapshot = {};
function refreshSnapshot() {
  priceSnapshot = {};
  COINS.forEach(coin => {
    priceSnapshot[coin.id] = {};
    EXCHANGES.forEach(ex => {
      priceSnapshot[coin.id][ex.id] = Math.round(jitter(coin.base, 1.4));
    });
  });
}
refreshSnapshot();

/* =========================================================================
   فرمت‌دهی
   ========================================================================= */

const faDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
function toFa(input) {
  return String(input).replace(/[0-9]/g, d => faDigits[+d]);
}
function fmtToman(n) {
  return toFa(Math.round(n).toLocaleString('en-US')) + ' تومان';
}
function fmtPct(n, withSign = true) {
  const s = n > 0 && withSign ? '+' : '';
  return toFa(s + n.toFixed(2)) + '٪';
}
function pctClass(n, hi = 1.5, mid = 0.5) {
  const a = Math.abs(n);
  if (a >= hi) return 'high';
  if (a >= mid) return 'mid';
  return 'low';
}

/* =========================================================================
   ۱) موتور آربیتراژ (با کارمزد واقعی)
   ========================================================================= */

// TODO(اتصال واقعی): حجم قابل‌معامله را از عمق سفارش (Order Book) هر صرافی و
// زمان انتقال شبکه را از تنظیمات شبکه هر رمزارز (مثلاً TRC20 چند دقیقه، شبکه
// اتریوم چند دقیقه) بگیر. اینجا فقط برای نمایش شبیه‌سازی شده.
function mockLiquidity(coinId) {
  // تتر و رمزارزهای پرحجم، نقدشوندگی بالاتری می‌گیرند
  const base = { USDT: 92, BTC: 80, ETH: 75, TON: 55, DOGE: 60, TRX: 65 }[coinId] || 50;
  return Math.round(jitter(base, 15));
}
function mockTransferMinutes(coinId) {
  const base = { USDT: 3, BTC: 35, ETH: 6, TON: 2, DOGE: 15, TRX: 2 }[coinId] || 10;
  return Math.max(1, Math.round(jitter(base, 25)));
}

function computeArbitrage() {
  return COINS.map(coin => {
    const prices = EXCHANGES.map(ex => ({ ex, price: priceSnapshot[coin.id][ex.id] }));
    const buy = prices.reduce((a, b) => (b.price < a.price ? b : a));
    const sell = prices.reduce((a, b) => (b.price > a.price ? b : a));
    const rawSpreadPct = (sell.price - buy.price) / buy.price * 100;
    const netPct = rawSpreadPct - buy.ex.feePct - sell.ex.feePct;
    const liquidity = mockLiquidity(coin.id);
    const transferMin = mockTransferMinutes(coin.id);
    // فرصت «واقعی» یعنی: سود خالص از حداقل تعیین‌شده بیشتر باشد، نقدشوندگی کافی باشد
    // و زمان انتقال آنقدر طولانی نباشد که تا رسیدن وجه، قیمت‌ها هم‌گرا شده باشند.
    const isReal = netPct >= settings.minProfit && liquidity >= 50 && transferMin <= 20;
    return { coin, buy, sell, rawSpreadPct, netPct, liquidity, transferMin, isReal };
  }).sort((a, b) => b.netPct - a.netPct);
}

function renderArbitrage() {
  const list = computeArbitrage();
  const root = document.getElementById('arbList');
  root.innerHTML = '';
  list.forEach(item => {
    const verdict = item.isReal
      ? '<span class="spread-pill low" style="background:rgba(31,157,124,.15);color:#4fd3ac">فرصت واقعی: تأیید شد</span>'
      : '<span class="spread-pill" style="background:#182420;color:#5f6b65">فرصت ظاهری: رد شد</span>';
    root.insertAdjacentHTML('beforeend', `
      <div class="opp-card">
        <div class="opp-top">
          <div class="opp-name"><span class="opp-coin-badge">${item.coin.id.slice(0,3)}</span>${item.coin.name}</div>
          <span class="spread-pill ${pctClass(item.netPct)}">${fmtPct(item.netPct)}</span>
        </div>
        <div class="opp-route">
          خرید از <b>${item.buy.ex.name}</b><span class="arrow">←</span>فروش در <b>${item.sell.ex.name}</b>
        </div>
        <div class="opp-route">اسپرد خام: <b>${fmtPct(item.rawSpreadPct)}</b> — نقدشوندگی: <b>${toFa(item.liquidity)}٪</b> — زمان انتقال تقریبی: <b>${toFa(item.transferMin)} دقیقه</b></div>
        <div class="opp-route">${verdict}</div>
        <div class="opp-foot">
          <div class="opp-prices mono">${fmtToman(item.buy.price)} → ${fmtToman(item.sell.price)}</div>
          <button class="mini-btn" onclick="logSignal('arb','${item.coin.name}: ${item.buy.ex.name}←${item.sell.ex.name}', ${item.netPct.toFixed(3)})">ثبت سیگنال</button>
        </div>
      </div>
    `);
  });
}

/* =========================================================================
   ۲) تحلیل طلا و سکه (حباب)
   ========================================================================= */

function goldGramPrice(ounce, usd) {
  return (ounce / 31.1035) * usd;
}

function computeGold() {
  const g = settings.gold;
  const type = COIN_TYPES[g.coinType];
  const gram24 = goldGramPrice(g.ounce, g.usd);
  const intrinsic = gram24 * type.purity * type.weight;
  const market = g.market || intrinsic;
  const bubblePct = ((market - intrinsic) / intrinsic) * 100;
  return { type, gram24, intrinsic, market, bubblePct };
}

function goldDecision(bubblePct) {
  if (bubblePct <= 0) return { label: 'خرید', reasons: ['قیمت بازار زیر ارزش ذاتی است', 'حباب منفی یا صفر'] };
  if (bubblePct < settings.thGold) return { label: 'صبر', reasons: ['حباب در محدوده معمول بازار است', 'هنوز به آستانه ریسک نرسیده'] };
  return { label: 'عدم خرید', reasons: ['حباب از آستانه تعیین‌شده عبور کرده', 'ریسک اصلاح قیمت در کوتاه‌مدت بالاست'] };
}

function renderGold() {
  const g = settings.gold;
  document.getElementById('coinType').value = g.coinType;
  document.getElementById('inOunce').value = g.ounce;
  document.getElementById('inUsd').value = g.usd;
  document.getElementById('inMarket').value = g.market || '';

  const r = computeGold();
  const circumference = 251.2;
  const clamped = Math.max(-15, Math.min(15, r.bubblePct));
  const frac = (clamped + 15) / 30;
  const offset = circumference * (1 - frac);
  const arc = document.getElementById('gaugeArc');
  arc.style.strokeDashoffset = offset;
  arc.style.stroke = r.bubblePct > settings.thGold ? '#E5484D' : (r.bubblePct < 0 ? '#1F9D7C' : '#C9A227');
  document.getElementById('gaugePct').textContent = fmtPct(r.bubblePct);

  const d = goldDecision(r.bubblePct);
  document.getElementById('goldSummary').innerHTML = `
    قیمت هر گرم طلای ۲۴ عیار: <b class="mono">${fmtToman(r.gram24)}</b><br>
    ارزش ذاتی ${r.type.label}: <b class="mono">${fmtToman(r.intrinsic)}</b><br>
    قیمت بازار وارد شده: <b class="mono">${fmtToman(r.market)}</b><br>
    توصیه: <b>${d.label}</b> — ${d.reasons.join('، ')}
  `;
}

/* =========================================================================
   ۳) صندوق‌های طلا/نقره/کالا
   ========================================================================= */

function computeFunds() {
  return FUNDS.map(f => {
    const diffPct = (f.market - f.nav) / f.nav * 100;
    return { ...f, diffPct };
  }).sort((a, b) => a.diffPct - b.diffPct);
}

function renderFunds() {
  const list = computeFunds();
  const root = document.getElementById('fundsList');
  root.innerHTML = '';
  list.forEach((f, i) => {
    const tag = f.diffPct < 0 ? 'زیر NAV (ارزان)' : 'بالای NAV (حباب)';
    root.insertAdjacentHTML('beforeend', `
      <div class="opp-card">
        <div class="opp-top">
          <div class="opp-name"><span class="rank-badge">${toFa(i+1)}</span>&nbsp;${f.name} <span style="color:#5f6b65;font-size:11px">(${f.symbol})</span></div>
          <span class="spread-pill ${pctClass(f.diffPct)}">${fmtPct(f.diffPct)}</span>
        </div>
        <div class="opp-route">نوع دارایی: <b>${f.type}</b> — ${tag}</div>
        <div class="opp-foot">
          <div class="opp-prices mono">NAV ${toFa(f.nav.toLocaleString('en-US'))} ← بازار ${toFa(f.market.toLocaleString('en-US'))}</div>
          <button class="mini-btn" onclick="logSignal('fund','${f.name}', ${f.diffPct.toFixed(3)})">ثبت سیگنال</button>
        </div>
      </div>
    `);
  });
}

/* =========================================================================
   ۴) موتور رتبه‌بندی و تصمیم‌گیری
   نکته صادقانه: «اعتماد٪» اینجا یک شاخص قاعده‌محور ساده است (فاصله از آستانه‌ها)،
   نه یک مدل یادگیری‌ماشین آموزش‌دیده روی داده واقعی.
   ========================================================================= */

function buildOpportunities() {
  const arb = computeArbitrage().slice(0, 3).map(a => ({
    kind: 'رمزارز', title: `${a.coin.name}: ${a.buy.ex.name} ← ${a.sell.ex.name}`,
    score: a.netPct, threshold: settings.minProfit, raw: a,
    reasons: [
      a.isReal ? 'بعد از کسر کارمزد دو صرافی همچنان سودآور است' : 'بعد از کسر کارمزد یا به‌خاطر نقدشوندگی/زمان انتقال، فرصت واقعی نیست',
      `نقدشوندگی ${toFa(a.liquidity)}٪ و زمان انتقال حدود ${toFa(a.transferMin)} دقیقه`,
    ],
  }));
  const g = computeGold();
  const gd = goldDecision(g.bubblePct);
  const gold = [{
    kind: 'طلا/سکه', title: COIN_TYPES[settings.gold.coinType].label,
    score: -Math.abs(g.bubblePct) + (g.bubblePct <= 0 ? 4 : 0),
    threshold: settings.thGold, raw: g, bubblePct: g.bubblePct, reasons: gd.reasons,
  }];
  const funds = computeFunds().slice(0, 2).map(f => ({
    kind: 'صندوق', title: `${f.name} (${f.symbol})`,
    score: -f.diffPct, threshold: settings.thFund, raw: f,
    reasons: [
      f.diffPct < 0 ? 'قیمت تابلو زیر NAV است — نسبت به ارزش خالص دارایی ارزان‌تر معامله می‌شود' : 'قیمت تابلو بالای NAV است — حباب اسمی دارد',
      `فاصله از NAV: ${fmtPct(f.diffPct)}`,
    ],
  }));
  const all = [...arb, ...gold, ...funds];
  return all.map(o => {
    const confidence = Math.max(30, Math.min(95, 55 + Math.abs(o.score) * 6));
    let decision;
    if (o.kind === 'طلا/سکه') decision = gd.label;
    else decision = o.score > o.threshold ? 'خرید/فرصت' : (o.score < 0 ? 'صبر' : 'زیر آستانه');
    const risk = confidence > 75 ? 'کم' : confidence > 55 ? 'متوسط' : 'بالا';
    return { ...o, confidence: Math.round(confidence), decision, risk };
  }).sort((a, b) => b.confidence - a.confidence);
}

function decisionClass(label) {
  if (label.includes('خرید')) return 'buy';
  if (label.includes('صبر') || label.includes('زیر آستانه')) return 'wait';
  return 'sell';
}

function renderDashboard() {
  const list = buildOpportunities();
  const heroRoot = document.getElementById('heroCard');
  const miniRoot = document.getElementById('dashMini');
  if (!list.length) {
    heroRoot.innerHTML = '<div class="empty-hero">فرصتی یافت نشد</div>';
    miniRoot.innerHTML = '';
    return;
  }
  const top = list[0];
  heroRoot.innerHTML = `
    <div class="hero-card">
      <div class="hero-top">
        <div>
          <div class="hero-label">بهترین فرصت الان</div>
          <div class="hero-title">${top.title}</div>
          <div class="hero-kind">${top.kind}</div>
        </div>
      </div>
      <div class="hero-decision ${decisionClass(top.decision)}">${top.decision}</div>
      <div class="hero-meta">
        <div>اعتماد: <b>${toFa(top.confidence)}٪</b></div>
        <div>ریسک: <b>${top.risk}</b></div>
      </div>
      <ul class="hero-reasons">${top.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
    </div>
  `;
  miniRoot.innerHTML = '';
  list.slice(1, 5).forEach((o, i) => {
    miniRoot.insertAdjacentHTML('beforeend', `
      <div class="opp-card">
        <div class="opp-top">
          <div class="rank-row-top"><span class="rank-badge">${toFa(i+2)}</span><span class="opp-name">${o.title}</span></div>
          <span class="spread-pill ${pctClass(o.confidence, 75, 55)}">${toFa(o.confidence)}٪</span>
        </div>
        <div class="opp-route">${o.kind} — پیشنهاد: <b>${o.decision}</b></div>
      </div>
    `);
  });
}

function renderRank() {
  const list = buildOpportunities();
  const root = document.getElementById('rankList');
  root.innerHTML = '';
  list.forEach((o, i) => {
    root.insertAdjacentHTML('beforeend', `
      <div class="opp-card">
        <div class="opp-top">
          <div class="rank-row-top"><span class="rank-badge">${toFa(i+1)}</span><span class="opp-name">${o.title}</span></div>
          <span class="spread-pill ${pctClass(o.confidence, 75, 55)}">${toFa(o.confidence)}٪ اعتماد</span>
        </div>
        <div class="opp-route">نوع: <b>${o.kind}</b> — پیشنهاد: <b>${o.decision}</b> — ریسک: <b>${o.risk}</b></div>
      </div>
    `);
  });
}

/* =========================================================================
   پرتفوی شخصی
   ========================================================================= */

const PF_SUB_OPTIONS = {
  crypto: COINS.map(c => ({ value: c.id, label: c.name })),
  gold: Object.entries(COIN_TYPES).map(([k, v]) => ({ value: k, label: v.label })),
  fund: FUNDS.map(f => ({ value: f.symbol, label: f.name })),
  cash: [{ value: 'toman', label: 'تومان نقد' }],
};

function fillPfSub() {
  const type = document.getElementById('pfType').value;
  const sub = document.getElementById('pfSub');
  sub.innerHTML = PF_SUB_OPTIONS[type].map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  document.getElementById('pfSubWrap').style.display = type === 'cash' ? 'none' : 'flex';
}
document.getElementById('pfType').addEventListener('change', fillPfSub);

document.getElementById('addPfBtn').addEventListener('click', () => {
  const type = document.getElementById('pfType').value;
  const sub = document.getElementById('pfSub').value;
  const qty = +document.getElementById('pfQty').value;
  const avgPrice = +document.getElementById('pfAvgPrice').value || 0;
  if (!qty || qty <= 0) { toast('مقدار را درست وارد کن'); return; }
  portfolio.push({ id: Date.now(), type, sub, qty, avgPrice });
  saveJSON('bb_portfolio', portfolio);
  document.getElementById('pfQty').value = '';
  document.getElementById('pfAvgPrice').value = '';
  renderPortfolio();
  toast('به پرتفوی اضافه شد');
});

function removePf(id) {
  portfolio = portfolio.filter(p => p.id !== id);
  saveJSON('bb_portfolio', portfolio);
  renderPortfolio();
}

function renderPortfolio() {
  const root = document.getElementById('pfList');
  root.innerHTML = '';
  let total = 0, totalCost = 0;
  portfolio.forEach(p => {
    const price = p.type === 'cash' ? 1 : currentPriceFor(p.type, p.sub);
    const value = price * p.qty;
    total += value;
    if (p.avgPrice) totalCost += p.avgPrice * p.qty;
    const subLabel = (PF_SUB_OPTIONS[p.type].find(o => o.value === p.sub) || {}).label || p.sub;
    const pl = p.avgPrice ? value - (p.avgPrice * p.qty) : null;
    root.insertAdjacentHTML('beforeend', `
      <div class="opp-card">
        <div class="pf-row">
          <div class="opp-name">${subLabel} <span style="color:#5f6b65;font-size:11px">(${toFa(p.qty)})</span></div>
          <button class="pf-remove" onclick="removePf(${p.id})">حذف</button>
        </div>
        <div class="opp-prices mono">ارزش فعلی: ${fmtToman(value)}${pl !== null ? ` — سود/زیان: ${pl >= 0 ? '+' : ''}${fmtToman(pl)}` : ''}</div>
      </div>
    `);
  });
  const plTotal = totalCost ? total - totalCost : null;
  document.getElementById('pfTotal').innerHTML = portfolio.length ? `
    ارزش کل پرتفوی: <b class="mono">${fmtToman(total)}</b><br>
    ${plTotal !== null ? `سود/زیان کل: <b class="mono">${plTotal >= 0 ? '+' : ''}${fmtToman(plTotal)}</b>` : 'برای دیدن سود/زیان، قیمت خرید را هم وارد کن'}
  ` : 'هنوز دارایی‌ای اضافه نکرده‌ای.';
}

/* =========================================================================
   تاریخچه و ثبت عملکرد سیگنال‌ها
   ========================================================================= */

function logSignal(type, title, valueAtLog) {
  history.unshift({ id: Date.now(), type, title, valueAtLog, ts: Date.now() });
  saveJSON('bb_history', history);
  renderHistory();
  toast('سیگنال ثبت شد ✓');
}

function currentValueForHistory(entry) {
  if (entry.type === 'arb') {
    const found = computeArbitrage().find(a => `${a.coin.name}: ${a.buy.ex.name}←${a.sell.ex.name}` === entry.title);
    return found ? found.netPct : entry.valueAtLog;
  }
  if (entry.type === 'gold') return computeGold().bubblePct;
  if (entry.type === 'fund') {
    const list = computeFunds();
    const f = list.find(x => entry.title.includes(x.symbol));
    return f ? f.diffPct : entry.valueAtLog;
  }
  return entry.valueAtLog;
}

function renderHistory() {
  const root = document.getElementById('historyList');
  root.innerHTML = '';
  if (!history.length) {
    root.innerHTML = '<div class="empty-state">هنوز سیگنالی ثبت نکرده‌ای. از تب‌های دیگر روی «ثبت سیگنال» بزن.</div>';
    return;
  }
  history.forEach(h => {
    const now = currentValueForHistory(h);
    const delta = now - h.valueAtLog;
    const cls = delta >= 0 ? 'pos' : 'neg';
    const typeName = { arb: 'آربیتراژ رمزارز', gold: 'طلا/سکه', fund: 'صندوق' }[h.type] || h.type;
    root.insertAdjacentHTML('beforeend', `
      <div class="hist-card">
        <div class="hist-top"><span class="hist-type">${typeName}</span><span class="hist-time">${new Date(h.ts).toLocaleString('fa-IR')}</span></div>
        <div class="hist-title">${h.title}</div>
        <div>مقدار هنگام ثبت: <span class="mono">${fmtPct(h.valueAtLog)}</span> ← اکنون: <span class="mono">${fmtPct(now)}</span></div>
        <div class="hist-delta ${cls}">تغییر: ${fmtPct(delta)}</div>
      </div>
    `);
  });
}

document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  if (!confirm('کل تاریخچه پاک شود؟')) return;
  history = [];
  saveJSON('bb_history', history);
  renderHistory();
});

/* =========================================================================
   هشدارها / نوتیفیکیشن
   ========================================================================= */

function toast(msg) {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function notify(title, body) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg) reg.showNotification(title, { body, icon: 'icons/icon-192.png' });
          else new Notification(title, { body });
        }).catch(() => new Notification(title, { body }));
      } else {
        new Notification(title, { body });
      }
    } catch (e) { /* noop */ }
  }
  toast(`${title} — ${body}`);
}

function updateNotifPermUI() {
  const box = document.getElementById('notifPermBox');
  const text = document.getElementById('notifPermText');
  if (typeof Notification === 'undefined') {
    text.textContent = 'مرورگر فعلی از نوتیفیکیشن پشتیبانی نمی‌کند.';
    box.querySelector('button').style.display = 'none';
    return;
  }
  if (Notification.permission === 'granted') {
    text.textContent = 'نوتیفیکیشن فعال است ✓';
    box.querySelector('button').style.display = 'none';
  } else {
    text.textContent = 'برای دریافت هشدار روی گوشی، ابتدا اجازه نوتیفیکیشن را بده.';
    box.querySelector('button').style.display = 'inline-block';
  }
}

document.getElementById('askPermBtn').addEventListener('click', async () => {
  if (typeof Notification === 'undefined') return;
  await Notification.requestPermission();
  updateNotifPermUI();
});

let lastAlertedKeys = new Set();
function checkAlerts() {
  if (settings.alertTypes.arb) {
    computeArbitrage().forEach(a => {
      if (!settings.favoriteCoins.includes(a.coin.id)) return;
      if (a.netPct >= settings.thArb) {
        const key = 'arb-' + a.coin.id;
        if (!lastAlertedKeys.has(key)) {
          notify('فرصت آربیتراژ پیدا شد', `${a.coin.name}: خرید ${a.buy.ex.name} ← فروش ${a.sell.ex.name} — سود خالص ${fmtPct(a.netPct)}`);
          lastAlertedKeys.add(key);
        }
      }
    });
  }
  if (settings.alertTypes.gold) {
    const g = computeGold();
    if (Math.abs(g.bubblePct) >= settings.thGold) {
      const key = 'gold';
      if (!lastAlertedKeys.has(key)) {
        notify('حباب سکه/طلا وارد محدوده هشدار شد', `${COIN_TYPES[settings.gold.coinType].label}: حباب ${fmtPct(g.bubblePct)}`);
        lastAlertedKeys.add(key);
      }
    }
  }
  if (settings.alertTypes.fund) {
    computeFunds().forEach(f => {
      if (Math.abs(f.diffPct) >= settings.thFund) {
        const key = 'fund-' + f.symbol;
        if (!lastAlertedKeys.has(key)) {
          notify('فاصله قابل‌توجه از NAV', `${f.name}: ${fmtPct(f.diffPct)}`);
          lastAlertedKeys.add(key);
        }
      }
    });
  }
}

/* =========================================================================
   رویدادهای ورودی و ذخیره تنظیمات
   ========================================================================= */

['inOunce','inUsd','inMarket','coinType'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    settings.gold.ounce = +document.getElementById('inOunce').value || settings.gold.ounce;
    settings.gold.usd = +document.getElementById('inUsd').value || settings.gold.usd;
    settings.gold.market = +document.getElementById('inMarket').value || 0;
    settings.gold.coinType = document.getElementById('coinType').value;
    saveJSON('bb_settings', settings);
    renderGold();
  });
});

document.getElementById('logGoldBtn').addEventListener('click', () => {
  const r = computeGold();
  logSignal('gold', COIN_TYPES[settings.gold.coinType].label, r.bubblePct);
});

const ALERT_TYPE_LABELS = { arb: 'آربیتراژ رمزارز', gold: 'حباب طلا/سکه', fund: 'صندوق‌ها' };

document.getElementById('saveAlertsBtn').addEventListener('click', () => {
  settings.thArb = +document.getElementById('thArb').value || settings.thArb;
  settings.thGold = +document.getElementById('thGold').value || settings.thGold;
  settings.thFund = +document.getElementById('thFund').value || settings.thFund;
  settings.minProfit = +document.getElementById('inMinProfit').value || settings.minProfit;
  settings.capital = +document.getElementById('inCapital').value || 0;
  settings.riskLevel = document.getElementById('inRisk').value;
  settings.favoriteCoins = Array.from(document.querySelectorAll('#favCoins input:checked')).map(el => el.value);
  Object.keys(settings.alertTypes).forEach(k => {
    settings.alertTypes[k] = document.getElementById('alertType_' + k).checked;
  });
  saveJSON('bb_settings', settings);
  lastAlertedKeys.clear();
  toast('تنظیمات ذخیره شد');
});

function fillAlertInputs() {
  document.getElementById('thArb').value = settings.thArb;
  document.getElementById('thGold').value = settings.thGold;
  document.getElementById('thFund').value = settings.thFund;
  document.getElementById('inMinProfit').value = settings.minProfit;
  document.getElementById('inCapital').value = settings.capital || '';
  document.getElementById('inRisk').value = settings.riskLevel;

  const favRoot = document.getElementById('favCoins');
  if (!favRoot.dataset.built) {
    favRoot.innerHTML = COINS.map(c => `
      <label class="fav-chip"><input type="checkbox" value="${c.id}" ${settings.favoriteCoins.includes(c.id) ? 'checked' : ''}>${c.name}</label>
    `).join('');
    favRoot.dataset.built = '1';
  }

  const atRoot = document.getElementById('alertTypes');
  if (!atRoot.dataset.built) {
    atRoot.innerHTML = Object.keys(settings.alertTypes).map(k => `
      <label class="fav-chip"><input type="checkbox" id="alertType_${k}" ${settings.alertTypes[k] ? 'checked' : ''}>${ALERT_TYPE_LABELS[k]}</label>
    `).join('');
    atRoot.dataset.built = '1';
  }
}

/* =========================================================================
   ناوبری تب‌ها
   ========================================================================= */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('view-' + btn.dataset.view).classList.remove('hidden');
  });
});

/* =========================================================================
   رفرش کلی
   ========================================================================= */

function renderAll() {
  refreshSnapshot();
  renderArbitrage();
  renderGold();
  renderFunds();
  renderRank();
  renderDashboard();
  renderPortfolio();
  renderHistory();
  fillAlertInputs();
  updateNotifPermUI();
  document.getElementById('lastUpdate').textContent = 'به‌روزرسانی: ' + new Date().toLocaleTimeString('fa-IR');
  checkAlerts();
}

document.getElementById('refreshBtn').addEventListener('click', renderAll);

fillPfSub();
renderAll();
setInterval(renderAll, 20000);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
