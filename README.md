# 무한매수법 4.0 자동매매 (Google Apps Script + 한국투자증권 Open API)

`src/` 안의 `.gs` 파일과 `appsscript.json`을 Apps Script 프로젝트에 올립니다 (`clasp push` 또는 복사/붙여넣기). clasp 설치와 사용법은 아래 [clasp로 배포하기](#clasp로-배포하기) 참고.

## 파일
| 파일 | 역할 |
|---|---|
| Strategy.gs | 순수 계산: 호가, 별지점, 처음매수/전반전/후반전/리버스 주문 생성, 체결 후 T·모드 갱신, 시간외종가 추가매수 수량 (Node 시뮬레이션으로 검증) |
| Kis.gs | KIS API 래퍼 (토큰 캐시, 시세, 주문, 체결조회, 휴장일) |
| SheetIO.gs | 사용자 종목 탭 읽기/행 추가, 설정·상태·로그·종가 시트 |
| Main.gs | 매분 `tick()` + 시간창 스케줄, 단계별 실행(PHASES) |
| Config.gs | 스케줄·시트 열 매핑 |

## 설치
모든 설정·주문 정보는 **종목 탭 상단 패널**에서 읽습니다(`자동설정`·`자동상태`·`자동종가` 시트 불필요). 셀 위치는 `Config.gs`의 `CFG.PANEL`.
1. 스크립트 속성(계정별, 종목 탭 `P2`의 4자리 = 계정): `KIS_APP_KEY_<계정>`, `KIS_APP_SECRET_<계정>`, `KIS_CANO_<계정>`, `KIS_ACNT_PRDT_CD_<계정>`, 선택 `KIS_MOCK_<계정>`. 공통: `KIS_MOCK`, `DRY_RUN`(true), 독립 프로젝트면 `SHEET_ID`, 선택 `ALERT_EMAIL`, `US_ORDER_TIME`(23:35, 서머 22:35), `US_SETTLE_TIME`(07:00)
2. 자동 대상: 탭의 `R2`(주문 방식)=`자동`, `P2`(계정)·`B2`(종목) 채움. 시장은 `D10`(국내/해외).
3. `checkSetup()` → 속성·패널·오늘 주문 계획 점검, `checkConnection()` → 토큰·현재가 점검.
4. `installTriggers()` 1회. DRY_RUN=true로 며칠 로그(`자동로그`) 확인 후 모의 → 실전.

### 시트에서 읽는 값
모드 F2, T H2, 잔고수량 H3, 전일종가 H4, 평단 H5, 잔금 F3, 매수예산 F4, 별지점 F6, **다음 단계 F7(N0/N1/N2/R1/R2/R3)**, 매수표 M2:N10(가격/수량), 매도 J2/K2(별지점 LOC), J3/K3(일반 3/4 지정가), 별%기준·목표수익률 B5, 리버스 종료 B6, 분할수 B4.
스크립트는 시트의 값을 그대로 주문하고, 독립 계산(Strategy.gs)과 달라지면 `자동로그`에 ⚠로 남깁니다. 체결 후에는 로그 표에 날짜·T·수량·매매가·종가·별지점·메모를 기록하고 계산 열은 직전 행의 수식을 복사합니다.

## clasp로 배포하기
`clasp`는 내 컴퓨터의 소스를 **Apps Script 프로젝트로 올리는**(Google 공식) 명령줄 도구입니다. 에디터에 복사/붙여넣기 하는 대신 `clasp push` 한 번으로 `src/`의 파일을 모두 올립니다.

| 명령 | 하는 일 |
|---|---|
| `git push` | 소스를 **GitHub**에 올림 (백업·이력) |
| `clasp push` | 소스를 **Apps Script**에 올림 (실제로 실행되는 코드) |
| `clasp pull` | Apps Script의 코드를 컴퓨터로 내려받음 |

> GitHub에 올렸다고 Apps Script가 바뀌지는 않습니다. 코드를 고치면 `clasp push`(실행용)와 `git push`(백업용) **둘 다** 해야 합니다.

### 설치 (Windows, 최초 1회)
1. **Node.js(LTS)** 설치: <https://nodejs.org> 에서 LTS 설치 후 새 터미널에서 `node -v`, `npm -v`로 확인.
2. **clasp** 설치: `npm install -g @google/clasp` → `clasp -v`로 확인.
3. **Apps Script API 켜기**: <https://script.google.com/home/usersettings> 에서 *Google Apps Script API*를 **사용**으로 변경 (꺼져 있으면 push가 실패).
4. **로그인**: `clasp login` → 브라우저에서 Apps Script 프로젝트 소유 계정으로 허용.

### 프로젝트 연결 (최초 1회)
저장소 폴더(예: `C:\VSCODE\infinite_buy_gas`)에 `.clasp.json`을 만듭니다. `.clasp.json.example`을 복사해서 `scriptId`만 내 것으로 바꾸면 됩니다.
```json
{ "scriptId": "<스크립트 ID>", "rootDir": "src" }
```
- **스크립트 ID**: Apps Script 에디터 → ⚙ 프로젝트 설정 → *스크립트 ID*.
- `rootDir`이 `src`여야 `src/*.gs`와 `src/appsscript.json`이 프로젝트 루트로 올라갑니다.
- `.clasp.json`은 `.gitignore`에 들어 있어 GitHub에는 올라가지 않습니다.
- 처음부터 받아오려면: `clasp clone <스크립트 ID> --rootDir src`

### 평소 사용 순서
```
(src/*.gs 수정)
clasp push                 # Apps Script에 반영
git add .
git commit -m "변경 내용"
git push                   # GitHub에 백업
```
| 명령 | 설명 |
|---|---|
| `clasp status` | 올라갈(바뀐) 파일 목록 확인 |
| `clasp push -w` | 파일 저장 때마다 자동 push (감시 모드, Ctrl+C로 종료) |
| `clasp open-script` | 브라우저에서 Apps Script 에디터 열기 |
| `clasp pull` | 에디터에서 직접 고친 내용을 컴퓨터로 받기 |
| `clasp logs` | 최근 실행 로그 보기 |

### 주의
- `clasp push`는 해당 프로젝트의 파일을 **덮어씁니다.** 에디터에서 직접 고친 내용이 있으면 먼저 `clasp pull`로 받아 두세요.
- push 후에는 에디터를 새로고침하고 바뀐 함수(예: `Ctrl+F`로 검색)가 보이는지 확인합니다. 스크립트 **속성**(키·`DRY_RUN` 등)은 push로 바뀌지 않습니다.
- push 해도 **트리거는 그대로** 유지됩니다(매분 `tick()`이 새 코드로 실행). 매매 시간(09:05, 15:20~16:10) 중에는 push를 피하세요.
- 오류별 대처: `User has not enabled the Apps Script API` → 설치 3단계, `Could not read API credentials` / 로그인 만료 → `clasp login`, `Missing required parameters: scriptId` → `.clasp.json` 위치(저장소 루트) 확인.

## 일정 (KST)
국내: 09:05 계획+3/4 지정가 매도 → 15:20 종가단일가 지정가(LOC 대체) → 15:35 체결 반영 → 15:40 시간외종가 추가매수(옵션) → 16:10 확인.
미국: US_ORDER_TIME 에 계획+LOC/지정가/MOC 주문 → 다음날 US_SETTLE_TIME 체결 반영.

## 트리거 제약과 대응
- 시간 트리거는 정시 보장이 없음(±수 분) → 매분 `tick()` + 시간창(win) 안에서만 실행.
- 중복 실행 방지: `LockService` + 단계별 `done:날짜:단계` 플래그(실행 전에 기록. 실패 시 자동 재시도 안 함 — 주문 중복 방지, 알림 이메일).
- 6분 실행 제한: 종목 루프에서 270초 넘으면 중단·알림.
- KIS 토큰은 24시간 유효·분당 1회 발급 → 스크립트 속성에 캐시. 초당 호출 제한은 1회 재시도.
- 휴장일: 국내는 KIS 휴장일 API로 건너뜀(실패 시 평일 간주). 미국 휴장은 주문 거부로 알림.

## KIS 문서 대조 결과 (2026-11 API 목록 기준)
- 맞음: 토큰발급, 국내 주문(TTTC0011U/0012U, ORD_DVSN 00/01/06), 해외 주문(TTTT1002U/1006U, 33 MOC·34 LOC), 현재가(FHKST01010100, HHDFS00000300), 잔고/체결 TR_ID.
- 수정함: 해외 매도에 `SLL_TYPE=00`, 국내 체결조회 `EXCG_ID_DVSN_CD=KRX` 필수값, 국내 잔고 `INQR_DVSN=01`, 연속조회(tr_cont) 지원(실전 50/100/20건·모의 20/15/15건 제한), 해외 체결조회 모의 파라미터(PDNO·거래소 공백, 구분 00), 실전/모의 토큰 캐시 분리, 휴장일 1일 1회 캐시·모의 미지원 처리.
- 한계: 해외 모의투자는 지정가(00)만 가능 → 모의에서는 LOC/MOC를 지정가로 대체해 동작만 시험(LOC 체결 조건 검증은 실전 소액으로).

## 반드시 확인할 것 (미검증)
- KIS TR_ID·필드명·ORD_DVSN(국내 00 지정가/01 시장가/06 시간외종가, 해외 33 MOC/34 LOC)은 공식 문서 기준으로 확인하세요. 실제 API는 호출해 보지 못했습니다(모의투자로 먼저).
- 리버스 LOC 매도 시 T 갱신식(`T×(1−2/N)`), 4주 미만 쿼터매도 수량, 종가단일가 주문 시 15:20 이후 취소 불가는 가정입니다 (`결정필요사항` 탭 #2, #4).
- 종목 탭 열 매핑(`Config.gs`의 `CFG.TAB`)이 실제 시트와 같은지 확인하세요 (현재 KODEX 탭: A날짜 B T C수량 D매매가 E종가 F평단 N예수금, 11행부터).
- 새 행은 직전 행의 F~N 수식을 복사합니다. 잔금 수식은 `N전−G−I` 이어야 합니다.