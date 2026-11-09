/**
 * 라오어 무한매수법 4.0 — 순수 계산 모듈 (Apps Script API 미사용 → Node에서 그대로 테스트 가능)
 *
 * P(종목 설정): {market:'KR'|'US', type:'ETF'|'STOCK', N, starBase, targetPct, revExitPct,
 *               bigPct, ladderStep, ladderCount, quarterMinOne}
 * S(상태):      {mode:'N'|'R', T, qty, avg, cash, revDay}   revDay: 리버스 진입 후 첫날 전 0, 이후 1
 * ctx:          {prevClose, closes:[...최근 종가 오래된→최신]}
 */
var IB = (typeof IB !== 'undefined') ? IB : {};

// ───────── 호가 · 반올림 ─────────
IB.tickKR = function (price, type) {
  if (type === 'ETF') return price < 2000 ? 1 : 5;
  var t = [[0, 1], [2000, 5], [5000, 10], [20000, 50], [50000, 100], [200000, 500], [500000, 1000]], k = 1;
  for (var i = 0; i < t.length; i++) if (price >= t[i][0]) k = t[i][1];
  return k;
};
IB.tick = function (P, price) { return P.market === 'KR' ? IB.tickKR(price, P.type) : 0.01; };
IB.rnd = function (P, x) { return P.market === 'KR' ? Math.round(x) : Math.round(x * 100) / 100; };
IB.floorTick = function (P, p) { var t = IB.tick(P, p); return IB.rnd(P, Math.floor(p / t + 1e-9) * t); };
IB.ceilTick = function (P, p) { var t = IB.tick(P, p); return IB.rnd(P, Math.ceil(p / t - 1e-9) * t); };
/** 매수 LOC 가격 = (매도 호가 = 기준가 올림) − 1틱. 사용자 시트(M2 = J2 − 호가단위, J2 = CEILING(별지점))와 동일 규칙 → 결정사항 #7 */
IB.buyBelow = function (P, p) { var c = IB.ceilTick(P, p); return IB.rnd(P, c - IB.tick(P, c)); };

// ───────── 기본 수식 ─────────
IB.starPct = function (P, T) { return P.starBase - (P.starBase * 2 / P.N) * T; };      // 단위: 소수 (0.15 …)
IB.starPrice = function (P, avg, T) { return avg * (1 + IB.starPct(P, T)); };
IB.mean = function (a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };

IB.quarterQty = function (P, qty) {
  var q = Math.floor(qty / 4);
  if (q === 0 && P.quarterMinOne && qty > 1) q = 1;   // 결정사항 #2
  return q;
};

// ───────── 주문 계획 ─────────
IB.plan = function (P, S, ctx) {
  var N = P.N, out = { mode: S.mode, tag: '', orders: [], notes: [], errors: [], T0: S.T, qty0: S.qty, avg0: S.avg, cash0: S.cash, revDay0: S.revDay, star: null, budget: 0 };
  function add(group, side, kind, qty, price) {
    if (qty > 0) out.orders.push({ id: group + '#' + out.orders.length, group: group, side: side, kind: kind, qty: qty, price: price });
  }
  function ladder(bud, tot, maxPrice) {
    for (var n = 1; n <= P.ladderCount; n++) {
      var raw = bud / (tot + n * P.ladderStep), p = IB.buyBelow(P, raw);
      p = IB.rnd(P, Math.min(p, raw));
      if (p > 0 && p < maxPrice) add('ladder', 'BUY', 'LOC', P.ladderStep, p);
    }
  }

  if (S.mode === 'N') {
    if (S.T > N - 1 + 1e-9 && S.qty > 0) { out.errors.push('일반모드인데 T>N-1 → 리버스 전환 필요'); return out; }
    var bud = Math.min(S.cash, S.cash / (N - S.T)); out.budget = bud;
    if (S.qty === 0) {                                              // N0 처음매수
      out.tag = 'N0';
      var big = IB.floorTick(P, ctx.prevClose * (1 + P.bigPct)), q = Math.floor(bud / big);
      if (q <= 0) out.errors.push('N0 큰수 LOC 수량 0 (예산 ' + bud + ' < 가격 ' + big + ')');
      add('big', 'BUY', 'LOC', q, big);
      ladder(bud, q, big);
      return out;
    }
    var star = IB.starPrice(P, S.avg, S.T); out.star = star;
    var sp = IB.buyBelow(P, star);
    if (S.T < N / 2) {                                              // N1 전반전
      out.tag = 'N1';
      var ap = IB.buyBelow(P, S.avg), qs = Math.floor(bud / 2 / sp), qa = Math.floor(bud / 2 / ap);
      if (qs <= 0) out.errors.push('N1 별LOC 수량 0'); if (qa <= 0) out.errors.push('N1 평단LOC 수량 0');
      add('star', 'BUY', 'LOC', qs, sp); add('avg', 'BUY', 'LOC', qa, ap);
      ladder(bud, qs + qa, Math.min(sp, ap));
    } else {                                                        // N2 후반전
      out.tag = 'N2';
      var qf = Math.floor(bud / sp);
      if (qf <= 0) out.errors.push('N2 별LOC 수량 0');
      add('main', 'BUY', 'LOC', qf, sp);
      ladder(bud, qf, sp);
    }
    var q4 = IB.quarterQty(P, S.qty);
    add('quarter', 'SELL', 'LOC', q4, IB.ceilTick(P, star));
    add('target', 'SELL', 'LIMIT', S.qty - q4, IB.ceilTick(P, S.avg * (1 + P.targetPct)));
    return out;
  }

  // ───── 리버스 ─────
  var half = N / 2, sellQ = Math.floor(S.qty / half);
  if (S.revDay === 0) {                                             // R1 첫날: MOC 매도, 매수 없음
    out.tag = 'R1';
    if (sellQ <= 0) out.errors.push('R1 MOC 매도 수량 0');
    add('moc', 'SELL', 'MOC', sellQ, 0);
    return out;
  }
  var rs = IB.mean(ctx.closes.slice(-5)); out.star = rs;
  var qb = IB.buyBelow(P, rs), rbud = S.cash / 4; out.budget = rbud;
  var rq = qb > 0 ? Math.floor(rbud / qb) : 0;
  if (rq <= 0) {                                                    // R3: 1주도 못 사면 MOC 매도로 대체 (가이드 2-(1))
    out.tag = 'R3'; out.notes.push('쿼터매수 1주 불가 → MOC 매도');
    if (sellQ <= 0) out.errors.push('R3 MOC 매도 수량 0');
    add('moc', 'SELL', 'MOC', sellQ, 0);
    return out;
  }
  out.tag = 'R2';
  add('rbuy', 'BUY', 'LOC', rq, qb);
  ladder(rbud, rq, qb);
  if (sellQ <= 0) out.errors.push('R2 LOC 매도 수량 0');
  add('rsell', 'SELL', 'LOC', sellQ, IB.ceilTick(P, rs));
  return out;
};

// ───────── 체결 반영 → 다음 T / 모드 ─────────
/** fills: {orderId:{qty,price}} (미체결은 없음)   close: 당일 종가
 *  S는 "당일 시작 전 상태". 수량/평단/잔금은 시트가 다시 계산하므로 여기서는 T·모드·revDay만 구한다. */
IB.apply = function (P, S, plan, fills, close, qtyAfter, avgAfter) {
  var N = P.N, g = {}, rows = [], i;
  for (i = 0; i < plan.orders.length; i++) {
    var o = plan.orders[i], f = fills[o.id];
    if (f && f.qty > 0) {
      g[o.group] = (g[o.group] || 0) + f.qty;
      rows.push({ group: o.group, side: o.side, qty: f.qty, price: f.price });
    }
  }
  var T = S.T, mode = S.mode, revDay = S.revDay, events = [];
  if (S.mode === 'N') {
    if (g.target > 0) { T = S.T * 0.25; events.push('지정가 매도'); }
    else if (g.quarter > 0) { T = S.T * 0.75; events.push('쿼터매도'); }
    var inc = 0;
    if (g.big > 0 || g.main > 0) inc = 1;
    else if (g.star > 0 && g.avg > 0) inc = 1;
    else if (g.star > 0 || g.avg > 0) inc = 0.5;
    T += inc;
    if (qtyAfter === 0 && S.qty > 0) { T = 0; events.push('사이클 종료'); }
    else if (T > N - 1 + 1e-9) { mode = 'R'; revDay = 0; events.push('리버스 진입'); }
  } else {
    if (S.revDay === 0) { T = S.T * (N === 20 ? 0.9 : 0.95); revDay = 1; events.push('리버스 첫날 MOC'); }
    else {
      if (g.rsell > 0 || g.moc > 0) T = T * (1 - 2 / N);               // 결정사항 #4 (가정)
      if (g.rbuy > 0) T = T + (N - T) * 0.25;
    }
    if (qtyAfter === 0) { mode = 'N'; T = 0; revDay = 0; events.push('소진 → 사이클 종료'); }
    else if (S.revDay === 1 && close > avgAfter * (1 + P.revExitPct)) { mode = 'N'; revDay = 0; events.push('리버스 종료 → 일반모드'); }
  }
  T = Math.round(T * 1e9) / 1e9;
  return { T: T, mode: mode, revDay: revDay, rows: rows, events: events, groups: g };
};

/** KR 시간외종가 추가매수 수량: 체결된 그룹의 (배정예산 − 체결금액) 합 ÷ 종가. 미체결 그룹 예산은 쓰지 않음 */
IB.topupQty = function (P, plan, fills, close) {
  var alloc = {}, spent = {}, i, o, f;
  var groupsBuy = {};
  for (i = 0; i < plan.orders.length; i++) { o = plan.orders[i]; if (o.side === 'BUY') groupsBuy[o.group] = 1; }
  var bud = plan.budget;
  // 그룹별 배정: 전반전 star/avg 각 1/2, 그 외 전액 (줍줍은 소속 그룹 예산 안에서 소진되므로 별도 배정 없음)
  var share = (plan.tag === 'N1') ? { star: bud / 2, avg: bud / 2 } : (plan.tag === 'N0') ? { big: bud } : (plan.tag === 'N2') ? { main: bud } : (plan.tag === 'R2') ? { rbuy: bud } : {};
  var filledMain = {}, ladderAmt = 0, mainAmt = {};
  for (i = 0; i < plan.orders.length; i++) {
    o = plan.orders[i]; f = fills[o.id]; if (!f || !(f.qty > 0) || o.side !== 'BUY') continue;
    if (o.group === 'ladder') ladderAmt += f.qty * f.price; else { filledMain[o.group] = 1; mainAmt[o.group] = (mainAmt[o.group] || 0) + f.qty * f.price; }
  }
  var avail = 0, spentAll = ladderAmt;
  for (var k in filledMain) { avail += share[k] || 0; spentAll += mainAmt[k]; }
  var left = avail - spentAll;
  return left > 0 ? Math.floor(left / close) : 0;
};
