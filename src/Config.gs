/** ===== 설정 ===== 민감값(키·계좌)은 코드에 넣지 말고 [프로젝트 설정 → 스크립트 속성]에 저장하세요.
 *  KIS_APPKEY, KIS_APPSECRET, KIS_ACCOUNT(앞 8자리), KIS_ACNT_PRDT(보통 01)
 *  KIS_MOCK = true|false   (모의투자 여부)
 *  DRY_RUN  = true|false   (true면 주문 전송 없이 로그만. 기본 true → 검증 후 false로)
 *  ALERT_EMAIL = (선택) 오류 알림 받을 이메일
 *  US_ORDER_TIME = 23:35 (서머타임 22:35),  US_SETTLE_TIME = 07:00
 */
var CFG = {
  SHEET_SETTINGS: '자동설정',      // 종목별 설정 표 (installSheets()가 생성)
  SHEET_STATE: '자동상태',         // 종목별 모드/리버스 첫날 여부
  SHEET_LOG: '자동로그',
  SHEET_HIST: '자동종가',          // 날짜/종목/종가 (리버스 5일 평균용)
  // 사용자 시트(종목 탭) 열 매핑 — 현재 KODEX 탭 기준. 바꾸면 여기만 수정.
  TAB: { HEADER_ROW: 10, FIRST_ROW: 11, DATE: 'A', T: 'B', QTY: 'C', PRICE: 'D', CLOSE: 'E', AVG: 'F', CASH: 'N', PRINCIPAL_CELL: 'B3',
          FORMULA_FROM: 'F', FORMULA_TO: 'N', MEMO: 'M' },   // 새 행에 직전 행의 F~N 수식 복사, 메모(M)는 비움
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
  BIG_PCT: 0.12, REV_EXIT: { 20: -0.15 }   // 종목 설정 표에서 덮어씀
};
function prop_(k, d) { var v = PropertiesService.getScriptProperties().getProperty(k); return v === null || v === '' ? d : v; }
function isDry_() { return String(prop_('DRY_RUN', 'true')) !== 'false'; }
