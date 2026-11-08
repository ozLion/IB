/** 설치 점검용 — 값은 출력하지 않고 "있음/없음/길이"만 표시합니다. 편집기에서 직접 실행 후 [실행 로그]를 보세요. */

/** 1단계: 네트워크 없이 속성·시트 패널 점검 */
function checkSetup() {
  var out = [], ok = true, total = 0, p = PropertiesService.getScriptProperties(), P = CFG.PANEL;
  function line(s) { out.push(s); }
  line('── 공통 속성 ──');
  ['DRY_RUN', 'KIS_MOCK'].forEach(function (k) { line(k + ' = ' + (p.getProperty(k) === null ? '(없음 → 기본값 사용)' : p.getProperty(k))); });
  var ss; try { ss = ss_(); line('스프레드시트 연결: OK (' + ss.getName() + ')'); } catch (e) { return finish_(out.concat(['❌ 스프레드시트에 연결 못 함: ' + e.message + ' → 독립 프로젝트면 SHEET_ID 필요']), false); }
  line('── 탭 진단 (패널 ' + P.MARKER_CELL + '="' + P.MARKER_TEXT + '" 인 탭만 대상) ──');
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (!isPanelSheet_(sh)) { line('· ' + name + ': 종목 패널 아님 → 무시'); return; }
    var pn = panel_(sh), auto = String(pn.get(P.AUTO)).trim(), acct = String(pn.get(P.ACCT)).trim(), code = String(pn.get(P.TICKER)).trim();
    line('· ' + name + ': 종목 ' + code + ' / 시장 ' + pn.get(P.MARKET) + ' / ' + P.AUTO + '="' + auto + '" / 계정(' + P.ACCT + ')=' + (acct || '(비어 있음)') + ' / 모드 ' + pn.get(P.MODE) + ' / 단계 ' + pn.get(P.PHASE));
    if (auto !== P.AUTO_ON) { line('   → 자동 아님: 건너뜀'); return; }
    total++;
    if (!acct) { ok = false; line('   ❌ ' + P.ACCT + ' 계정이 비어 있음'); return; }
    ['APP_KEY', 'APP_SECRET', 'CANO', 'ACNT_PRDT_CD'].forEach(function (n) {
      var key = 'KIS_' + n + '_' + acct, v = p.getProperty(key);
      if (v === null || v === '') { ok = false; line('   ❌ ' + key + ' 없음'); return; }
      var warn = '';
      if (v !== v.trim()) warn += ' ⚠ 앞뒤 공백';
      if (n === 'CANO' && !/^\d{8}$/.test(v.trim())) warn += ' ⚠ 8자리 숫자 아님(길이 ' + v.length + ')';
      if (n === 'ACNT_PRDT_CD' && !/^\d{2}$/.test(v.trim())) warn += ' ⚠ 2자리 숫자 아님(길이 ' + v.length + ')';
      if (n === 'APP_KEY' && v.trim().length !== 36) warn += ' ⚠ 길이 ' + v.length + ' (문서상 36자)';
      if (n === 'APP_SECRET' && v.trim().length < 100) warn += ' ⚠ 길이 ' + v.length + ' (너무 짧음, 잘렸을 수 있음)';
      line('   ' + (warn ? '⚠ ' : '✔ ') + key + ' 있음 (길이 ' + v.length + ')' + warn);
      if (warn) ok = false;
    });
    line('   모의투자 여부: ' + (String(prop_('KIS_MOCK_' + acct, prop_('KIS_MOCK', 'false'))) === 'true' ? '모의' : '실전'));
    try {
      var t = loadTickers(/^\d/.test(code) ? 'KR' : 'US').filter(function (x) { return x.tab === name; })[0];
      if (!t) { line('   (loadTickers 에서 제외됨 — 시장 값 확인)'); return; }
      var pl = planFromSheet_(t, kstNow_());
      line('   주문 계획: ' + describe_(pl));
    } catch (e) { ok = false; line('   ❌ 계획 읽기 실패: ' + e.message); }
  });
  if (!total) { ok = false; line('❌ 자동 대상 탭이 없습니다. 종목 탭의 ' + P.AUTO + ' 셀을 "' + P.AUTO_ON + '"으로 하세요.'); }
  finish_(out, ok);
}

/** 2단계: 실제로 KIS에 접속해 토큰 발급 + 현재가 조회 (주문은 하지 않음) */
function checkConnection() {
  var out = [], ok = true;
  ['KR', 'US'].forEach(function (mk) {
    loadTickers(mk).forEach(function (t) {
      try {
        KIS.use(t.acct); KIS.token();
        out.push('✔ [' + t.acct + '] 토큰 OK (' + (KIS.mock() ? '모의' : '실전') + ')');
        var px = mk === 'KR' ? KIS.priceKR(t.code) : KIS.priceUS(t.code, t.excd);
        out.push('✔ ' + t.code + ' 현재가 ' + px);
        if (mk === 'KR') out.push('✔ 보유수량 ' + KIS.holdingKR(t.code) + ' (시트 잔고수량과 비교하세요)');
      } catch (e) { ok = false; out.push('❌ [' + t.acct + '] ' + t.code + ': ' + e.message); }
    });
  });
  finish_(out, ok);
}
function finish_(out, ok) { out.push(ok ? '\n결과: 문제 없음' : '\n결과: ❌ 위 항목을 수정하세요'); Logger.log(out.join('\n')); }
