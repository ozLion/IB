/** 설치 점검용 — 값은 절대 출력하지 않고 "있음/없음/길이"만 표시합니다. 편집기에서 직접 실행 후 [실행 로그]를 보세요. */

/** 1단계: 네트워크 없이 속성·시트 설정만 점검 */
function checkSetup() {
  var out = [], ok = true, total = 0;
  function line(s) { out.push(s); }
  var p = PropertiesService.getScriptProperties();
  line('── 공통 속성 ──');
  ['DRY_RUN', 'KIS_MOCK'].forEach(function (k) { line(k + ' = ' + (p.getProperty(k) === null ? '(없음 → 기본값 사용)' : p.getProperty(k))); });
  line('SHEET_ID = ' + (prop_('SHEET_ID', '') ? '있음' : '(없음 → 시트에 연결된 프로젝트로 동작)'));
  var sh; try { sh = ss_(); line('스프레드시트 연결: OK (' + sh.getName() + ')'); } catch (e) { ok = false; line('❌ 스프레드시트에 연결 못 함: ' + e.message + ' → 독립 프로젝트면 SHEET_ID 필요'); return finish_(out, ok); }
  var st = sh.getSheetByName(CFG.SHEET_SETTINGS);
  if (!st) { ok = false; line('❌ "' + CFG.SHEET_SETTINGS + '" 시트가 없습니다 → installSheets() 를 먼저 실행하세요'); return finish_(out, ok); }
  line('── ' + CFG.SHEET_SETTINGS + ' 시트 진단 (데이터 ' + Math.max(0, st.getLastRow() - 1) + '줄) ──');
  if (st.getLastRow() >= 2) st.getRange(2, 1, st.getLastRow() - 1, 4).getValues().forEach(function (r, i) {
    var why = [];
    if (String(r[0]).trim().toUpperCase() !== 'Y') why.push('A열(사용)이 "Y"가 아님: "' + r[0] + '"');
    var m = String(r[3]).trim().toUpperCase(); if (m !== 'KR' && m !== 'US') why.push('D열(시장)이 KR/US가 아님: "' + r[3] + '"');
    if (!sh.getSheetByName(String(r[1]))) why.push('B열 탭 이름 "' + r[1] + '" 에 해당하는 탭이 없음(공백·글자 확인)');
    line((i + 2) + '행 [' + r[1] + ']: ' + (why.length ? '건너뜀 → ' + why.join(' / ') : 'OK'));
  });
  ['KR', 'US'].forEach(function (mk) {
    var ts = []; try { ts = loadTickers(mk); } catch (e) { ok = false; line('❌ 자동설정 읽기 실패: ' + e.message + ' (installSheets 실행 여부 확인)'); }
    total += ts.length;
    ts.forEach(function (t) {
      line('── ' + mk + ' / ' + t.tab + ' (' + t.code + ') ──');
      if (!t.acct) { ok = false; line('❌ ' + CFG.TAB.ACCT_CELL + ' 셀(계정 앞 4자리)이 비어 있음'); return; }
      line('계정(' + CFG.TAB.ACCT_CELL + ') = ' + t.acct + (/^\d{4}$/.test(t.acct) ? '' : '  ⚠ 숫자 4자리가 아님(숫자는 텍스트 서식 권장)'));
      ['APP_KEY', 'APP_SECRET', 'CANO', 'ACNT_PRDT_CD'].forEach(function (n) {
        var key = 'KIS_' + n + '_' + t.acct, v = p.getProperty(key);
        if (v === null || v === '') { ok = false; line('❌ ' + key + ' 없음'); return; }
        var warn = '';
        if (v !== v.trim()) warn += ' ⚠ 앞뒤 공백 있음';
        if (n === 'CANO' && !/^\d{8}$/.test(v.trim())) warn += ' ⚠ 8자리 숫자가 아님(길이 ' + v.length + ')';
        if (n === 'ACNT_PRDT_CD' && !/^\d{2}$/.test(v.trim())) warn += ' ⚠ 2자리 숫자가 아님(길이 ' + v.length + ')';
        if (n === 'APP_KEY' && v.trim().length !== 36) warn += ' ⚠ 길이 ' + v.length + ' (문서상 36자)';
        if (n === 'APP_SECRET' && v.trim().length < 100) warn += ' ⚠ 길이 ' + v.length + ' (문서상 최대 180자, 너무 짧음 → 잘렸을 수 있음)';
        line((warn ? '⚠ ' : '✔ ') + key + ' 있음 (길이 ' + v.length + ')' + warn);
        if (warn && /⚠/.test(warn)) ok = false;
      });
      line('모의투자 여부: ' + (String(prop_('KIS_MOCK_' + t.acct, prop_('KIS_MOCK', 'false'))) === 'true' ? '모의' : '실전'));
      var tab = sh.getSheetByName(t.tab);
      line('탭 "' + t.tab + '": ' + (tab ? '있음' : '❌ 없음'));
    });
    if (!ts.length) line('(' + mk + ' 사용 종목 없음)');
  });
  if (!total) { ok = false; line('❌ 자동설정 시트에 사용=Y 인 종목이 없습니다. 탭마다 한 줄씩 추가하세요(시장 KR/US, 시트 탭 이름은 실제 탭과 동일하게).'); }
  finish_(out, ok);
}

/** 2단계: 실제로 KIS에 접속해 토큰 발급 + 현재가 조회까지 확인 (주문은 하지 않음) */
function checkConnection() {
  var out = [], ok = true;
  ['KR', 'US'].forEach(function (mk) {
    loadTickers(mk).forEach(function (t) {
      try {
        KIS.use(t.acct);
        KIS.token();
        out.push('✔ [' + t.acct + '] 토큰 OK (' + (KIS.mock() ? '모의' : '실전') + ')');
        var px = mk === 'KR' ? KIS.priceKR(t.code) : KIS.priceUS(t.code, t.excd);
        out.push('✔ ' + t.code + ' 현재가 ' + px);
        if (mk === 'KR') out.push('✔ 보유수량 ' + KIS.holdingKR(t.code));
      } catch (e) { ok = false; out.push('❌ [' + t.acct + '] ' + t.code + ': ' + e.message); }
    });
  });
  finish_(out, ok);
}
function finish_(out, ok) { out.push(ok ? '\n결과: 문제 없음' : '\n결과: ❌ 위 항목을 수정하세요'); Logger.log(out.join('\n')); }
