/** ===== 설정 ===== 민감값은 코드에 넣지 말고 [프로젝트 설정 → 스크립트 속성]에 저장하세요.
 *  종목 탭의 P2 셀 = 계정 앞 4자리(예: 7441). 그 값이 속성 이름 뒤에 붙습니다.
 *  계정별 (필수):  KIS_APP_KEY_<계정>, KIS_APP_SECRET_<계정>, KIS_CANO_<계정>(계좌 앞 8자리), KIS_ACNT_PRDT_CD_<계정>(보통 01)
 *  계정별 (선택):  KIS_MOCK_<계정> = true|false (없으면 공통 KIS_MOCK, 그것도 없으면 false=실전)
 *  공통:           DRY_RUN = true|false (true면 주문 전송 없이 로그만. 기본 true), KIS_MOCK(기본 모의 여부),
 *                  SHEET_ID(독립 프로젝트일 때), ALERT_EMAIL(선택), US_ORDER_TIME(23:35, 서머 22:35), US_SETTLE_TIME(07:00)
 */
var CFG = {
  SHEET_LOG: '자동로그',
  PANEL_ROWS: 10,
  // 종목 탭 상단 패널 셀 (사용자 시트 기준). 위치가 바뀌면 여기만 수정
  PANEL: { MARKER_CELL: 'A2', MARKER_TEXT: '종목', TICKER: 'B2', PRINCIPAL: 'B3', N: 'B4', STAR_BASE: 'B5', REV_EXIT: 'B6',
           MODE: 'F2', T: 'H2', QTY: 'H3', PREV_CLOSE: 'H4', AVG: 'H5', CASH: 'F3', BUDGET: 'F4', STAR: 'F6', PHASE: 'F7',
           MARKET: 'D10', TICK: 'D6', ACCT: 'P2', AUTO: 'R2', AUTO_ON: '자동',
           SELL1_PRICE: 'J2', SELL1_QTY: 'K2', SELL2_PRICE: 'J3', SELL2_QTY: 'K3',
           BUY_FIRST_ROW: 2, BUY_LAST_ROW: 10, BUY_PRICE_COL: 'M', BUY_QTY_COL: 'N', BUY_LABEL: 'L3' },
  // 체결 기록 표: 헤더(HEADER_ROW) 이름으로 열을 찾고, 못 찾을 때만 아래 열 글자 사용
  TAB: { HEADER_ROW: 11, FIRST_ROW: 12, DATE: 'A', T: 'B', QTY: 'C', PRICE: 'D', CLOSE: 'E', STAR: 'G', MEMO: 'N' },
  DEFAULT_EXCD: 'NAS', TOPUP: false,   // 해외 거래소 / 국내 시간외종가 추가매수 사용 여부
  // 스케줄(KST). 윈도우 안에서만 실행 → 트리거 지연/중복 실행 방지
  SCHEDULE: [
    { phase: 'KR_OPEN',   market: 'KR', at: '09:05', win: 20, days: 'MF' },
    { phase: 'KR_CLOSE',  market: 'KR', at: '15:20', win: 8,  days: 'MF' },
    { phase: 'KR_SETTLE', market: 'KR', at: '15:35', win: 20, days: 'MF' },
    { phase: 'KR_TOPUP',  market: 'KR', at: '15:40', win: 15, days: 'MF' },
    { phase: 'KR_FINAL',  market: 'KR', at: '16:10', win: 40, days: 'MF' },
    { phase: 'US_ORDER',  market: 'US', propAt: 'US_ORDER_TIME',  def: '23:35', win: 25, days: 'MF' },
    { phase: 'US_SETTLE', market: 'US', propAt: 'US_SETTLE_TIME', def: '07:00', win: 60, days: 'TS' }   // 화~토
  ],
  EXCD: { NAS: 'NASD', NYS: 'NYSE', AMS: 'AMEX' },
  BIG_PCT: 0.12   // 처음매수(N0) 큰수 LOC: 전일종가 +12%
};
function prop_(k, d) { var v = PropertiesService.getScriptProperties().getProperty(k); return v === null || v === '' ? d : v; }
function isDry_() { return String(prop_('DRY_RUN', 'true')) !== 'false'; }