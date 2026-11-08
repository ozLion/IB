/** 시트 입출력 — 사용자 종목 탭(KODEX 레버리지 등)을 읽고 새 행을 추가 */
/** 스프레드시트에 바인딩된 스크립트면 자동, 독립 프로젝트면 스크립트 속성 SHEET_ID 에 시트 ID(URL의 /d/…/ 부분)를 넣으세요 */
function ss_() { var id = prop_('SHEET_ID', ''); return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet(); }
function col_(letter) { return ss_().getSheets()[0].getRange(letter + '1').getColumn(); }
function pct_(v) { v = Number(v); return Math.abs(v) > 1 ? v / 100 : v; }   // 15 → 0.15, 0.15 → 0.15

var SETTINGS_HEADER = ['사용(Y/N)', '시트 탭 이름', '종목코드', '시장(KR/US)', '거래소(NAS/NYS/AMS)', '유형(ETF/STOCK)', '분할수 N', '별% 기준(15/20)', '목표수익률 %', '리버스 종료 %(음수)', '줍줍 단위(주)', '줍줍 개수', '큰수 %(처음매수)', '시간외종가 추가매수(Y/N)', '쿼터 4주미만 1주(Y/N)'];
function installSheets() {
  var ss = ss_();
  function ensure(name, header) { var sh = ss.getSheetByName(name) || ss.insertSheet(name); if (sh.getLastRow() === 0 && header) sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold'); return sh; }
  var st = ensure(CFG.SHEET_SETTINGS, SETTINGS_HEADER);
  if (st.getLastRow() === 1) st.getRange(2, 1, 1, SETTINGS_HEADER.length).setValues([['N', 'KODEX 레버리지', '122630', 'KR', '', 'ETF', 40, 15, 15, -15, 1, 5, 12, 'N', 'N']]);
  ensure(CFG.SHEET_STATE, ['시트 탭 이름', '모드(N/R)', '리버스 첫날 전(0)/후(1)', '갱신']);
  ensure(CFG.SHEET_LOG, ['시각', '단계', '종목', '내용']);
  ensure(CFG.SHEET_HIST, ['날짜', '종목', '종가']);
}
function loadTickers(market) {
  var sh = ss_().getSheetByName(CFG.SHEET_SETTINGS); if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, SETTINGS_HEADER.length).getValues(), out = [];
  v.forEach(function (r) {
    if (String(r[0]).toUpperCase() !== 'Y' || String(r[3]).toUpperCase() !== market) return;
    out.push({ tab: String(r[1]), code: String(r[2]).replace(/^'/, '').trim(), market: market, excd: String(r[4] || 'NAS'),
      P: { market: market, type: String(r[5] || 'ETF').toUpperCase(), N: Number(r[6]), starBase: pct_(r[7]), targetPct: pct_(r[8]), revExitPct: pct_(r[9]) || -0.15,
           ladderStep: Number(r[10]) || 1, ladderCount: Number(r[11]) || 5, bigPct: pct_(r[12]) || CFG.BIG_PCT, quarterMinOne: String(r[14]).toUpperCase() === 'Y' },
      topup: String(r[13]).toUpperCase() === 'Y' });
  });
  return out;
}
function stateSheetRow_(tab) {
  var sh = ss_().getSheetByName(CFG.SHEET_STATE), v = sh.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (String(v[i][0]) === tab) return { sh: sh, row: i + 1, mode: String(v[i][1] || 'N'), revDay: Number(v[i][2] || 0) };
  sh.appendRow([tab, 'N', 0, new Date()]); return { sh: sh, row: sh.getLastRow(), mode: 'N', revDay: 0 };
}
function lastDataRow_(sh) {
  var c = CFG.TAB, a = sh.getRange(c.DATE + c.FIRST_ROW + ':' + c.DATE).getValues(), last = 0;
  for (var i = 0; i < a.length; i++) if (a[i][0] !== '' && a[i][0] !== null) last = c.FIRST_ROW + i;
  return last;
}
/** 종목 탭에서 현재 상태 읽기: T(마지막 행 값), 수량(누적), 평단/예수금(마지막 행) */
function readState(t) {
  var sh = ss_().getSheetByName(t.tab); if (!sh) throw new Error('시트 탭 없음: ' + t.tab);
  var c = CFG.TAB, last = lastDataRow_(sh), ms = stateSheetRow_(t.tab), S = { mode: ms.mode, revDay: ms.revDay, T: 0, qty: 0, avg: 0, cash: 0 };
  if (last === 0) { S.cash = Number(sh.getRange(c.PRINCIPAL_CELL).getValue()); return S; }
  var qtys = sh.getRange(c.QTY + c.FIRST_ROW + ':' + c.QTY + last).getValues();
  qtys.forEach(function (r) { S.qty += Number(r[0]) || 0; });
  S.T = Number(sh.getRange(c.T + last).getValue()) || 0;
  S.avg = S.qty > 0 ? Number(sh.getRange(c.AVG + last).getValue()) || 0 : 0;
  S.cash = Number(sh.getRange(c.CASH + last).getValue()) || 0;
  S.lastClose = Number(sh.getRange(c.CLOSE + last).getValue()) || 0;
  if (S.qty < 0) throw new Error(t.tab + ' 누적 수량이 음수');
  return S;
}
function saveMode_(tab, mode, revDay) {
  var m = stateSheetRow_(tab); m.sh.getRange(m.row, 2, 1, 3).setValues([[mode, revDay, new Date()]]);
}
/** 체결 행 추가: 매도(수량 음수) 먼저, 매수 나중. T는 해당 일 마지막 T를 모든 행에 기록 */
function appendRows(t, dateStr, close, T, rows) {
  var sh = ss_().getSheetByName(t.tab), c = CFG.TAB, ordered = rows.filter(function (r) { return r.side === 'SELL'; }).concat(rows.filter(function (r) { return r.side === 'BUY'; }));
  ordered.forEach(function (r) {
    var last = lastDataRow_(sh), nr = last + 1;
    if (last >= c.FIRST_ROW) {
      sh.getRange(c.FORMULA_FROM + last + ':' + c.FORMULA_TO + last).copyTo(sh.getRange(c.FORMULA_FROM + nr + ':' + c.FORMULA_TO + nr), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      sh.getRange(c.MEMO + nr).clearContent();
    }
    sh.getRange(c.DATE + nr).setValue(dateStr);
    sh.getRange(c.T + nr).setValue(T);
    sh.getRange(c.QTY + nr).setValue(r.side === 'SELL' ? -r.qty : r.qty);
    sh.getRange(c.PRICE + nr).setValue(r.price);
    sh.getRange(c.CLOSE + nr).setValue(close);
    sh.getRange(c.MEMO + nr).setValue('자동 ' + r.group);
  });
  SpreadsheetApp.flush();
}
function setLastT_(t, T) { var sh = ss_().getSheetByName(t.tab), c = CFG.TAB, last = lastDataRow_(sh); if (last) sh.getRange(c.T + last).setValue(T); }

// ── 종가 이력 ──
function histCloses_(code, n) {
  var sh = ss_().getSheetByName(CFG.SHEET_HIST), v = sh.getDataRange().getValues(), out = [];
  for (var i = 1; i < v.length; i++) if (String(v[i][1]) === code) out.push(Number(v[i][2]));
  return out.slice(-n);
}
function saveClose_(dateStr, code, close) {
  var sh = ss_().getSheetByName(CFG.SHEET_HIST), v = sh.getDataRange().getValues();
  for (var i = v.length - 1; i >= 1; i--) if (String(v[i][1]) === code && String(v[i][0]) === dateStr) return;   // 중복 방지
  sh.appendRow([dateStr, code, close]);
}
function log_(phase, ticker, msg) {
  try { ss_().getSheetByName(CFG.SHEET_LOG).appendRow([new Date(), phase, ticker, String(msg).slice(0, 1500)]); } catch (e) { Logger.log(msg); }
}
function alert_(subject, body) {
  Logger.log(subject + ' ' + body);
  var to = prop_('ALERT_EMAIL', ''); if (to) MailApp.sendEmail(to, '[무한매수] ' + subject, body);
}
