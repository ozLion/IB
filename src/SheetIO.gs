/** 시트 입출력 — 모든 설정·주문 정보는 종목 탭(예: KODEX 레버리지) 상단 패널에서 읽는다.
 *  패널 셀 위치는 Config.gs 의 CFG.PANEL 에서 한 곳만 바꾸면 된다. */
function ss_() { var id = prop_('SHEET_ID', ''); return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet(); }
function a1_(a1) { var m = /^([A-Z]+)(\d+)$/.exec(a1), c = 0; for (var i = 0; i < m[1].length; i++) c = c * 26 + m[1].charCodeAt(i) - 64; return { r: Number(m[2]), c: c }; }
function num_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

/** 패널 읽기 (A1:Z{PANEL_ROWS} 한 번에). 반환: {get(a1)} */
function panel_(sh) {
  var rows = CFG.PANEL_ROWS, v = sh.getRange(1, 1, rows, 26).getValues();
  return { get: function (a1) { var p = a1_(a1); return v[p.r - 1][p.c - 1]; } };
}
function isPanelSheet_(sh) { try { var p = panel_(sh), P = CFG.PANEL; return String(p.get(P.MARKER_CELL)).trim() === P.MARKER_TEXT; } catch (e) { return false; } }

/** 자동 대상 탭 찾기: 패널이 있고 R9(주문 방식)이 '자동', P9(계정)·B2(종목)가 채워진 탭. market: 'KR' | 'US' */
function loadTickers(market) {
  var P = CFG.PANEL, out = [];
  ss_().getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (!isPanelSheet_(sh)) return;
    var p = panel_(sh), mode = String(p.get(P.AUTO)).trim();
    if (mode !== P.AUTO_ON) return;
    var acct = String(p.get(P.ACCT)).trim(), code = String(p.get(P.TICKER)).trim();
    if (!acct || !code) { log_('LOAD', name, '자동인데 계정(' + P.ACCT + ') 또는 종목(' + P.TICKER + ')이 비어 있어 건너뜀'); return; }
    var mk = /^\d/.test(code) ? 'KR' : 'US';                             // 숫자 코드=국내, 알파벳=해외 (시트 D10 시장 값도 확인)
    var sheetMk = String(p.get(P.MARKET)).trim(); if (sheetMk === '국내') mk = 'KR'; else if (sheetMk === '해외') mk = 'US';
    if (mk !== market) return;
    if (mk === 'KR' && /^\d+$/.test(code)) code = ('000000' + code).slice(-6);
    out.push({ tab: name, acct: acct, code: code, market: mk, excd: CFG.DEFAULT_EXCD, topup: CFG.TOPUP,
      P: { market: mk, type: 'ETF', N: num_(p.get(P.N)), starBase: num_(p.get(P.STAR_BASE)), targetPct: num_(p.get(P.STAR_BASE)), revExitPct: num_(p.get(P.REV_EXIT)),
           ladderStep: 1, ladderCount: 9, bigPct: CFG.BIG_PCT, quarterMinOne: false } });
  });
  return out;
}

/** 시트 패널 → 오늘 주문 계획. 시트의 수식 결과를 그대로 신뢰하고, IB.plan(독립 계산)과 대조해 다르면 경고만 남긴다. */
function planFromSheet_(t, now) {
  var sh = ss_().getSheetByName(t.tab), p = panel_(sh), P = CFG.PANEL, N = t.P.N;
  var mode = String(p.get(P.MODE)).trim() === '리버스' ? 'R' : 'N';
  var tag = String(p.get(P.PHASE)).trim().toUpperCase().slice(0, 2);
  var S = { mode: mode, T: num_(p.get(P.T)), qty: num_(p.get(P.QTY)), avg: num_(p.get(P.AVG)), cash: num_(p.get(P.CASH)), revDay: 0 };
  if (['N0', 'N1', 'N2', 'R1', 'R2', 'R3'].indexOf(tag) < 0) throw new Error(t.tab + ' ' + P.PHASE + '(다음 단계) 값이 N0/N1/N2/R1/R2/R3 중 하나가 아님: "' + p.get(P.PHASE) + '"');
  if ((mode === 'R') !== (tag.charAt(0) === 'R')) throw new Error(t.tab + ' 모드(' + p.get(P.MODE) + ')와 단계(' + tag + ')가 맞지 않음');
  S.revDay = tag === 'R1' ? 0 : (mode === 'R' ? 1 : 0);
  var plan = { mode: mode, tag: tag, T0: S.T, qty0: S.qty, avg0: S.avg, cash0: S.cash, revDay0: S.revDay, budget: num_(p.get(P.BUDGET)), star: num_(p.get(P.STAR)), orders: [], notes: [], errors: [], date: now.ymd, S: { qty: S.qty, avg: S.avg } };
  var tickT = t.P.market === 'KR' ? Math.max(num_(p.get(P.TICK)), 1) : 0.01;
  function add(group, side, kind, qty, price, label) {
    qty = Math.floor(qty + 1e-9);
    if (!(qty > 0) || (kind !== 'MOC' && !(price > 0))) { plan.errors.push(tag + ' ' + label + ' 수량/가격 0 → 주문 생략 (수량 ' + qty + ', 가격 ' + price + ')'); return; }
    plan.orders.push({ id: group + '#' + plan.orders.length, group: group, side: side, kind: kind, qty: qty, price: price });
  }
  function ceilP(x) { return t.P.market === 'KR' ? Math.ceil(x / tickT - 1e-9) * tickT : Math.round(x * 100) / 100; }
  function floorP(x) { return t.P.market === 'KR' ? Math.floor(x / tickT + 1e-9) * tickT : Math.floor(x * 100 + 1e-6) / 100; }

  if (tag === 'N0') {                                                    // 처음매수는 수동: 주문·기록 모두 하지 않음
    plan.manual = true; plan.notes.push('N0 처음매수는 수동 → 자동 주문/기록 없음');
    return plan;
  }
  if (tag === 'R1' || tag === 'R3') {                                    // 리버스 첫날 / 1주 못 사는 날: MOC 매도, 매수 없음
    add('moc', 'SELL', 'MOC', num_(p.get(P.SELL1_QTY)), 0, 'MOC 매도');
  } else {
    // 매수표: M2:N10 (행 2 = 별지점/주 매수, 행 3 = 전반전 평단가 매수 or 줍줍, 이후 줍줍)
    var r0 = P.BUY_FIRST_ROW, r1 = P.BUY_LAST_ROW, label3 = String(p.get(P.BUY_LABEL)).trim();
    for (var r = r0; r <= r1; r++) {
      var price = num_(p.get(P.BUY_PRICE_COL + r)), qty = num_(p.get(P.BUY_QTY_COL + r));
      if (!(qty > 0) || !(price > 0)) continue;
      var grp = r === r0 ? (tag === 'N1' ? 'star' : tag === 'N2' ? 'main' : 'rbuy') : (r === r0 + 1 && label3.indexOf('평단') >= 0 ? 'avg' : 'ladder');
      add(grp, 'BUY', 'LOC', qty, floorP(price), '매수표 ' + r + '행');
    }
    var q1 = num_(p.get(P.SELL1_QTY)), px1 = ceilP(num_(p.get(P.SELL1_PRICE)));
    add(tag === 'R2' ? 'rsell' : 'quarter', 'SELL', 'LOC', q1, px1, '별지점 매도');
    if (tag !== 'R2') {
      var q2 = Math.min(Math.floor(num_(p.get(P.SELL2_QTY)) + 1e-9), S.qty - q1);
      add('target', 'SELL', 'LIMIT', q2, ceilP(num_(p.get(P.SELL2_PRICE))), '지정가 매도(3/4)');
    }
  }
  // 국내: 상·하한가 밖의 주문은 접수 거절되므로 제외 (체결될 수 없는 가격이라 결과 동일)
  if (t.market === 'KR' && plan.orders.length) {
    try {
      KIS.use(t.acct);
      var lim = KIS.limitsKR(t.code);
      if (lim.upper > 0 && lim.lower > 0) {
        var kept = [], dropped = [];
        plan.orders.forEach(function (o) {
          if (o.kind === 'MOC') { kept.push(o); return; }
          if (o.price < lim.lower || o.price > lim.upper) dropped.push(o.qty + '@' + o.price); else kept.push(o);
        });
        plan.orders = kept; plan.limits = lim;
        if (dropped.length) plan.notes.push('가격제한폭(하한 ' + lim.lower + ' / 상한 ' + lim.upper + ') 밖 주문 ' + dropped.length + '건 제외: ' + dropped.join(', '));
      }
    } catch (e) { plan.notes.push('⚠ 상·하한가 조회 실패 → 필터 미적용: ' + e.message); }
  }
  // 교차검증 (실패해도 시트 값을 따름)
  try {
    var ref = IB.plan(t.P, { mode: mode, T: S.T, qty: S.qty, avg: S.avg, cash: S.cash, revDay: S.revDay }, { prevClose: num_(p.get(P.PREV_CLOSE)), closes: closesFromTab_(sh, 5) });
    if (ref.tag !== tag) plan.notes.push('⚠ 단계 불일치: 시트 ' + tag + ' / 독립계산 ' + ref.tag);
    var a = plan.orders.filter(function (o) { return o.side === 'BUY' && o.group !== 'ladder'; })[0], b = ref.orders.filter(function (o) { return o.side === 'BUY' && o.group !== 'ladder'; })[0];
    if (a && b && (a.price !== b.price || a.qty !== b.qty)) plan.notes.push('⚠ 주 매수 불일치: 시트 ' + a.qty + '@' + a.price + ' / 독립계산 ' + b.qty + '@' + b.price);
    if (plan.star && ref.star && Math.abs(ref.star - plan.star) > tickT * 2) plan.notes.push('⚠ 별지점 불일치: 시트 ' + plan.star + ' / 독립계산 ' + Math.round(ref.star));
  } catch (e) { plan.notes.push('교차검증 생략: ' + e.message); }
  return plan;
}

// ───────── 로그 표(10행 이후) ─────────
/** 헤더(HEADER_ROW) 이름으로 열 탐색 */
function tabCols_(sh) {
  var c = CFG.TAB, lastCol = Math.max(sh.getLastColumn(), 1), h = sh.getRange(c.HEADER_ROW, 1, 1, lastCol).getValues()[0].map(function (v) { return String(v).replace(/\s+/g, ''); });
  function find(keys, fallback) { for (var i = 0; i < h.length; i++) for (var k = 0; k < keys.length; k++) if (h[i].indexOf(keys[k]) === 0) return i + 1; return a1_(fallback + '1').c; }
  var col = { DATE: find(['날짜'], c.DATE), T: find(['T'], c.T), QTY: find(['수량'], c.QTY), PRICE: find(['매매가'], c.PRICE), CLOSE: find(['종가'], c.CLOSE),
              STAR: find(['별지점'], c.STAR), MEMO: find(['메모'], c.MEMO) };
  var last = 0; for (var i = 0; i < h.length; i++) if (h[i] !== '') last = i + 1;
  col.FORMULA_FROM = col.CLOSE + 1; col.LAST = last;
  return col;
}
/** 마지막으로 '수량'이 채워진 행 (체결 기록 행) */
function lastFilledRow_(sh, col) {
  var c = CFG.TAB, n = Math.max(sh.getMaxRows() - c.FIRST_ROW + 1, 1), a = sh.getRange(c.FIRST_ROW, col.QTY, n, 1).getValues(), last = 0;
  for (var i = 0; i < a.length; i++) if (a[i][0] !== '' && a[i][0] !== null) last = c.FIRST_ROW + i;
  return last;
}
function closesFromTab_(sh, n) {
  var col = tabCols_(sh), c = CFG.TAB, last = lastFilledRow_(sh, col); if (!last) return [];
  var from = Math.max(c.FIRST_ROW, last - n + 1), v = sh.getRange(from, col.CLOSE, last - from + 1, 1).getValues();
  return v.map(function (r) { return num_(r[0]); }).filter(function (x) { return x > 0; });
}
/** 체결 행 기록. 아침에 날짜만 미리 넣어 둔 행(A=오늘, 수량 비어 있음)이 있으면 첫 행으로 쓰고, 이후는 새 행.
 *  계산 열(종가 오른쪽)은 직전 체결 행의 '수식'만 복사(상수·이자 등은 복사하지 않음). 매도(음수) 먼저, 매수 나중. */
function appendRows(t, dateStr, close, T, rows, star, tag) {
  var sh = ss_().getSheetByName(t.tab), c = CFG.TAB, col = tabCols_(sh);
  var ordered = rows.filter(function (r) { return r.side === 'SELL'; }).concat(rows.filter(function (r) { return r.side === 'BUY'; }));
  ordered.forEach(function (r) {
    var last = lastFilledRow_(sh, col), nr = last + 1;
    var dv = sh.getRange(nr, col.DATE).getValue(), pending = dv !== '' && dv !== null && Utilities.formatDate(new Date(dv), 'Asia/Seoul', 'yyyy-MM-dd') === dateStr;
    if (!pending && sh.getRange(nr, col.DATE).getValue() !== '') nr = Math.max(nr, sh.getLastRow() + 1);   // 다른 날짜 행이 이미 있으면 그 아래에
    if (last >= c.FIRST_ROW && col.LAST >= col.FORMULA_FROM) {
      var w = col.LAST - col.FORMULA_FROM + 1, f = sh.getRange(last, col.FORMULA_FROM, 1, w).getFormulasR1C1()[0].map(function (x) { return String(x).charAt(0) === '=' ? x : ''; });
      sh.getRange(nr, col.FORMULA_FROM, 1, w).setFormulasR1C1([f]);
    }
    sh.getRange(nr, col.DATE).setValue(pending ? dv : new Date(dateStr + 'T00:00:00+09:00')).setNumberFormat('yyyy-mm-dd (aaa)');
    sh.getRange(nr, col.T).setValue(T);
    sh.getRange(nr, col.QTY).setValue(r.side === 'SELL' ? -r.qty : r.qty);
    if (r.price !== '' && r.price !== null && r.price !== undefined) sh.getRange(nr, col.PRICE).setValue(r.price);
    sh.getRange(nr, col.CLOSE).setValue(close);
    if (star) sh.getRange(nr, col.STAR).setValue(Math.round(star));
    sh.getRange(nr, col.MEMO).setValue('자동 ' + (tag || '') + ' ' + r.group);
  });
  SpreadsheetApp.flush();
}

function installSheets() {
  var ss = ss_(), sh = ss.getSheetByName(CFG.SHEET_LOG);
  if (!sh) { sh = ss.insertSheet(CFG.SHEET_LOG); sh.getRange(1, 1, 1, 4).setValues([['시각', '단계', '종목', '내용']]).setFontWeight('bold'); }
}
function log_(phase, ticker, msg) {
  try { var sh = ss_().getSheetByName(CFG.SHEET_LOG); if (!sh) { installSheets(); sh = ss_().getSheetByName(CFG.SHEET_LOG); } sh.appendRow([new Date(), phase, ticker, String(msg).slice(0, 1500)]); } catch (e) { Logger.log(msg); }
}
function alert_(subject, body) {
  Logger.log(subject + ' ' + body);
  var to = prop_('ALERT_EMAIL', ''); if (to) MailApp.sendEmail(to, '[무한매수] ' + subject, body);
}
