/** 트리거 · 단계 실행 */
function kstNow_() { var d = new Date(); return { d: d, ymd: Utilities.formatDate(d, 'Asia/Seoul', 'yyyyMMdd'), dash: Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd'),
  dow: Number(Utilities.formatDate(d, 'Asia/Seoul', 'u')), min: Number(Utilities.formatDate(d, 'Asia/Seoul', 'H')) * 60 + Number(Utilities.formatDate(d, 'Asia/Seoul', 'm')) }; }
function hm_(s) { var p = String(s).split(':'); return Number(p[0]) * 60 + Number(p[1]); }

/** 1회만 실행: 분 단위 트리거 설치 (기존 트리거 제거 후). 시간 트리거는 '정시 보장'이 없어서 매분 tick() + 시간창 방식을 씀 */
function installTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('tick').timeBased().everyMinutes(1).create();
  Logger.log('매분 tick 트리거 설치 완료');
}
function removeTriggers() { ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tick') ScriptApp.deleteTrigger(t); }); }

/** 매분 호출. 조건이 안 맞으면 즉시 종료(수 ms) → 일일 트리거 실행시간 한도 안에서 운용 */
function tick() {
  var now = kstNow_(), lock = LockService.getScriptLock();
  if (!lock.tryLock(3000)) return;
  try {
    var p = PropertiesService.getScriptProperties();
    CFG.SCHEDULE.forEach(function (s) {
      var at = hm_(s.propAt ? prop_(s.propAt, s.def) : s.at);
      if (now.min < at || now.min >= at + s.win) return;
      var dowOk = s.days === 'MF' ? (now.dow >= 1 && now.dow <= 5) : (now.dow >= 2 && now.dow <= 6);
      if (!dowOk) return;
      var key = 'done:' + now.ymd + ':' + s.phase;
      if (p.getProperty(key)) return;
      p.setProperty(key, '1');                                    // 먼저 표시 → 중복 실행 방지(실패 시 알림, 자동 재시도는 하지 않음: 주문 중복 위험)
      if (s.market === 'KR' && !krOpen_(now.ymd)) { log_(s.phase, '-', '휴장일 → 건너뜀'); return; }
      runPhase_(s.phase, now);
    });
    if (now.min === 5) cleanupFlags_(now);
  } finally { lock.releaseLock(); }
}
/** 휴장일 조회는 첫 국내 종목의 계정으로 1회만 (결과는 날짜별 캐시) */
function krOpen_(ymd) {
  var ts = loadTickers('KR'); if (!ts.length) return false;
  KIS.use(ts[0].acct); return KIS.isKrOpen(ymd);
}
function cleanupFlags_(now) {
  var p = PropertiesService.getScriptProperties(), all = p.getProperties(), cut = Number(Utilities.formatDate(new Date(Date.now() - 5 * 86400000), 'Asia/Seoul', 'yyyyMMdd'));
  Object.keys(all).forEach(function (k) { var m = /^done:(\d{8}):/.exec(k); if (m && Number(m[1]) < cut) p.deleteProperty(k); });
}

function runPhase_(phase, now) {
  var market = phase.slice(0, 2), t0 = Date.now();
  loadTickers(market).forEach(function (t) {
    if (Date.now() - t0 > 270000) { alert_('시간 초과 위험', phase + ' ' + t.tab + ' 건너뜀'); return; }     // 6분 제한 보호
    try { KIS.use(t.acct); PHASES[phase](t, now); }
    catch (e) { alert_(phase + ' 실패: ' + t.tab, String(e && e.stack || e)); log_(phase, t.tab, 'ERROR ' + e); }
  });
}

// ── 상태 저장 (종목별 일일 계획/주문번호) ──
function planKey_(t) { return 'plan:' + t.tab; }
function savePlan_(t, o) { PropertiesService.getScriptProperties().setProperty(planKey_(t), JSON.stringify(o)); }
function loadPlan_(t) { var s = PropertiesService.getScriptProperties().getProperty(planKey_(t)); return s ? JSON.parse(s) : null; }

function makePlan_(t, now) {
  var S = readState(t), closes = histCloses_(t.code, 5), prev = closes.length ? closes[closes.length - 1] : (S.lastClose || (t.market === 'KR' ? KIS.priceKR(t.code) : KIS.priceUS(t.code, t.excd)));
  if (!closes.length && S.lastClose) closes = [S.lastClose];
  var plan = IB.plan(t.P, S, { prevClose: prev, closes: closes });
  plan.date = now.ymd; plan.S = S;
  return plan;
}
function describe_(plan) { return plan.tag + ' T=' + plan.T0 + ' 수량=' + plan.qty0 + ' 예산=' + Math.round(plan.budget) + ' ' + plan.orders.map(function (o) { return o.id + ':' + o.side + o.kind + ' ' + o.qty + '@' + o.price; }).join(' | ') + (plan.errors.length ? ' ⚠ ' + plan.errors.join('; ') : ''); }

function send_(t, o, dvsnMap) {
  if (isDry_()) return 'DRY-' + o.id;
  var d = dvsnMap[o.kind];
  if (t.market === 'US' && KIS.mock()) {                          // 문서: 해외 모의투자는 지정가(00)만 가능 → LOC/MOC를 지정가로 대체(동작 시험용)
    var px = o.kind === 'MOC' ? KIS.priceUS(t.code, t.excd) : o.price;
    return KIS.orderUS(t.code, CFG.EXCD[t.excd] || 'NASD', o.side, o.qty, px, '00');
  }
  return t.market === 'KR' ? KIS.orderKR(t.code, o.side, o.qty, d.price0 ? 0 : o.price, d.code) : KIS.orderUS(t.code, CFG.EXCD[t.excd] || 'NASD', o.side, o.qty, d.price0 ? 0 : o.price, d.code);
}
var DVSN_KR = { LOC: { code: '00' }, LIMIT: { code: '00' }, MOC: { code: '01', price0: true } };      // 국내: LOC=종가단일가 지정가(15:20)
var DVSN_US = { LOC: { code: '34' }, LIMIT: { code: '00' }, MOC: { code: '33', price0: true } };

var PHASES = {
  /** 09:05 국내: 오늘 계획 수립 + 3/4 지정가 매도(장중 일반 지정가, 당일 유효) */
  KR_OPEN: function (t, now) {
    var plan = makePlan_(t, now); plan.status = 'PLANNED'; plan.odno = {};
    log_('KR_OPEN', t.tab, describe_(plan));
    if (plan.errors.length) alert_('계획 오류: ' + t.tab, describe_(plan));
    plan.orders.filter(function (o) { return o.group === 'target'; }).forEach(function (o) { plan.odno[o.id] = send_(t, o, DVSN_KR); });
    savePlan_(t, plan);
  },
  /** 15:20 국내: 나머지 주문(LOC 대체 = 종가단일가 지정가). 잔고 재검증 후 전송. 이후 취소/정정 불가 */
  KR_CLOSE: function (t, now) {
    var plan = loadPlan_(t); if (!plan || plan.date !== now.ymd) throw new Error('오늘 계획 없음(KR_OPEN 미실행)');
    var held = isDry_() ? plan.qty0 : KIS.holdingKR(t.code), fills = isDry_() ? {} : KIS.fillsKR(now.ymd, t.code), targetLeft = 0, i, o;
    for (i = 0; i < plan.orders.length; i++) { o = plan.orders[i]; if (o.group === 'target') { var f = fills[plan.odno[o.id]]; targetLeft += o.qty - (f ? f.qty : 0); } }
    var sellable = held - targetLeft;                               // 오늘 더 팔 수 있는 수량
    plan.orders.forEach(function (o) {
      if (o.group === 'target' || plan.odno[o.id]) return;
      if (o.side === 'SELL') { if (o.qty > sellable) { log_('KR_CLOSE', t.tab, '매도 수량 조정 ' + o.qty + '→' + Math.max(0, sellable)); o.qty = Math.max(0, sellable); } sellable -= o.qty; if (o.qty <= 0) return; }
      plan.odno[o.id] = send_(t, o, DVSN_KR);
    });
    plan.status = 'ORDERED'; savePlan_(t, plan); log_('KR_CLOSE', t.tab, '주문 전송 ' + JSON.stringify(plan.odno) + (isDry_() ? ' (DRY_RUN)' : ''));
  },
  /** 15:35 국내: 체결 반영 → 시트 행 추가, T/모드 갱신 */
  KR_SETTLE: function (t, now) { settle_(t, now, now.ymd, function () { return KIS.priceKR(t.code); }, function () { return KIS.fillsKR(now.ymd, t.code); }); },
  /** 15:40 국내: 남은 예산 시간외종가 추가매수(옵션). 체결 안 되면 잔금으로 남김 */
  KR_TOPUP: function (t, now) {
    if (!t.topup) return;
    var plan = loadPlan_(t); if (!plan || plan.status !== 'SETTLED' || plan.date !== now.ymd) return;
    var q = IB.topupQty(t.P, plan, plan.fillsById || {}, plan.close);
    log_('KR_TOPUP', t.tab, '추가매수 수량 ' + q + ' @종가 ' + plan.close);
    if (q > 0) { plan.topupOdno = isDry_() ? 'DRY-topup' : KIS.orderKR(t.code, 'BUY', q, 0, '06'); plan.topupQty = q; savePlan_(t, plan); }
  },
  /** 16:10 국내: 시간외종가 체결 확인 → 행 추가 (T는 건드리지 않음) */
  KR_FINAL: function (t, now) {
    var plan = loadPlan_(t); if (!plan || !plan.topupOdno || plan.topupDone || isDry_()) return;
    var f = KIS.fillsKR(now.ymd, t.code)[plan.topupOdno];
    if (f) { appendRows(t, now.dash, plan.close, plan.newT, [{ group: 'topup', side: 'BUY', qty: f.qty, price: f.price }]); log_('KR_FINAL', t.tab, '시간외종가 체결 ' + f.qty + '@' + f.price); }
    else log_('KR_FINAL', t.tab, '시간외종가 미체결 → 잔금 유지');
    plan.topupDone = true; savePlan_(t, plan);
  },
  /** 미국: 장 시작 후 계획 + 전체 주문(LOC 34, 지정가 00, MOC 33) */
  US_ORDER: function (t, now) {
    var plan = makePlan_(t, now); plan.status = 'ORDERED'; plan.odno = {};
    log_('US_ORDER', t.tab, describe_(plan));
    if (plan.errors.length) alert_('계획 오류: ' + t.tab, describe_(plan));
    plan.orders.forEach(function (o) { plan.odno[o.id] = send_(t, o, DVSN_US); });
    savePlan_(t, plan);
  },
  /** 미국: 장 마감 후 체결 반영 (주문일 기준) */
  US_SETTLE: function (t, now) {
    var plan = loadPlan_(t); if (!plan || plan.status !== 'ORDERED') return;
    settle_(t, now, plan.date, function () { return KIS.priceUS(t.code, t.excd); }, function () { return KIS.fillsUS(plan.date); });
  }
};

function settle_(t, now, tradeYmd, getClose, getFills) {
  var plan = loadPlan_(t); if (!plan || plan.date !== tradeYmd || plan.status === 'SETTLED') { log_('SETTLE', t.tab, '정산할 계획 없음'); return; }
  var close = getClose(), raw = isDry_() ? {} : getFills(), fillsById = {}, S = plan.S;
  plan.orders.forEach(function (o) { var f = raw[plan.odno[o.id]]; if (f) fillsById[o.id] = f; });
  if (isDry_()) plan.orders.forEach(function (o) {                    // 모의 체결(로그 확인용): 종가 기준
    if ((o.side === 'BUY' && o.kind === 'LOC' && close <= o.price) || (o.side === 'SELL' && ((o.kind === 'LOC' && close >= o.price) || (o.kind === 'LIMIT' && close >= o.price))) || o.kind === 'MOC') fillsById[o.id] = { qty: o.qty, price: o.kind === 'LIMIT' ? o.price : close };
  });
  var sold = 0, buyAmt = 0, buyQty = 0, soldAmt = 0;
  plan.orders.forEach(function (o) { var f = fillsById[o.id]; if (!f) return; if (o.side === 'SELL') { sold += f.qty; soldAmt += f.qty * f.price; } else { buyQty += f.qty; buyAmt += f.qty * f.price; } });
  var qtyAfter = S.qty - sold + buyQty, costAfter = S.avg * (S.qty - sold) + buyAmt, avgAfter = qtyAfter ? costAfter / qtyAfter : 0;
  var R = IB.apply(t.P, { mode: plan.mode, T: plan.T0, qty: plan.qty0, avg: plan.avg0, cash: plan.cash0, revDay: plan.revDay0 }, plan, fillsById, close, qtyAfter, avgAfter);
  log_('SETTLE', t.tab, (isDry_() ? '[DRY] ' : '') + '종가 ' + close + ' 체결 ' + JSON.stringify(R.rows) + ' → T=' + R.T + ' 모드=' + R.mode + ' ' + R.events.join(','));
  if (!isDry_()) {
    if (R.rows.length) appendRows(t, Utilities.formatDate(new Date(plan.date.slice(0, 4) + '-' + plan.date.slice(4, 6) + '-' + plan.date.slice(6, 8) + 'T12:00:00+09:00'), 'Asia/Seoul', 'yyyy-MM-dd'), close, R.T, R.rows);
    else if (R.T !== S.T) setLastT_(t, R.T);
    saveMode_(t.tab, R.mode, R.revDay); saveClose_(plan.date, t.code, close);
  }
  plan.status = 'SETTLED'; plan.close = close; plan.fillsById = fillsById; plan.newT = R.T; savePlan_(t, plan);
}

/** 수동 점검용: 오늘 계획을 주문 없이 로그에 출력 */
function previewToday() {
  loadTickers('KR').concat(loadTickers('US')).forEach(function (t) { KIS.use(t.acct); var p = makePlan_(t, kstNow_()); log_('PREVIEW', t.tab, describe_(p)); Logger.log(describe_(p)); });
}
