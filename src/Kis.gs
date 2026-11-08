/** 한국투자증권 Open API 래퍼.  ※ TR_ID·필드명은 변경될 수 있으니 KIS 공식 문서와 대조해 확인하세요. */
var KIS = {};
KIS.base = function () { return String(prop_('KIS_MOCK', 'false')) === 'true' ? 'https://openapivts.koreainvestment.com:29443' : 'https://openapi.koreainvestment.com:9443'; };
KIS.mock = function () { return String(prop_('KIS_MOCK', 'false')) === 'true'; };
KIS.tr = function (real, mock) { return KIS.mock() ? mock : real; };

KIS.token = function () {
  var sfx = KIS.mock() ? '_M' : '_R';     // 실전/모의 토큰은 서로 다름
  var p = PropertiesService.getScriptProperties(), tk = p.getProperty('KIS_TOKEN' + sfx), exp = Number(p.getProperty('KIS_TOKEN_EXP' + sfx) || 0);
  if (tk && Date.now() < exp - 10 * 60 * 1000) return tk;
  var res = UrlFetchApp.fetch(KIS.base() + '/oauth2/tokenP', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ grant_type: 'client_credentials', appkey: prop_('KIS_APPKEY'), appsecret: prop_('KIS_APPSECRET') })
  });
  var j = JSON.parse(res.getContentText());
  if (!j.access_token) throw new Error('KIS 토큰 발급 실패: ' + res.getContentText());
  p.setProperty('KIS_TOKEN' + sfx, j.access_token);
  p.setProperty('KIS_TOKEN_EXP' + sfx, String(Date.now() + (Number(j.expires_in) || 86400) * 1000));   // 유효 24h, 6시간 내 재발급은 동일 토큰 반환 → 캐시
  return j.access_token;
};

KIS.call = function (method, path, trId, params, retry, trCont) {
  var url = KIS.base() + path, opt = { method: method, muteHttpExceptions: true, headers: {
    'content-type': 'application/json; charset=utf-8', authorization: 'Bearer ' + KIS.token(),
    appkey: prop_('KIS_APPKEY'), appsecret: prop_('KIS_APPSECRET'), tr_id: trId, custtype: 'P' } };
  if (trCont) opt.headers.tr_cont = trCont;
  if (method === 'get') {
    url += '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  } else opt.payload = JSON.stringify(params);
  var res = UrlFetchApp.fetch(url, opt), txt = res.getContentText(), j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('KIS 응답 파싱 실패 ' + res.getResponseCode() + ' ' + txt.slice(0, 200)); }
  if (res.getResponseCode() === 500 && /초당|EGW00201/.test(txt) && !retry) { Utilities.sleep(1100); return KIS.call(method, path, trId, params, true, trCont); }  // 초당 호출 제한
  if (j.rt_cd !== undefined && j.rt_cd !== '0') throw new Error('KIS 오류 [' + trId + '] ' + j.msg_cd + ' ' + j.msg1);
  var h = res.getAllHeaders(); j._trCont = h['tr_cont'] || h['Tr_cont'] || h['TR_CONT'] || '';
  return j;
};
/** 연속조회 (실전 50/100/20건, 모의 20/15/15건 제한 → 다음 페이지 반복). rowsKey: 'output1' | 'output' */
KIS.paged = function (path, trId, params, rowsKey, ctxKeys) {
  var rows = [], trCont = '', p = merge_({}, params), j;
  for (var i = 0; i < 20; i++) {
    j = KIS.call('get', path, trId, p, false, trCont);
    rows = rows.concat(j[rowsKey] || []);
    if (j._trCont !== 'M' && j._trCont !== 'F') break;
    ctxKeys.forEach(function (k) { p[k.toUpperCase()] = j[k]; });
    trCont = 'N'; Utilities.sleep(300);
  }
  return rows;
};
KIS.acct = function () { return { CANO: prop_('KIS_ACCOUNT'), ACNT_PRDT_CD: prop_('KIS_ACNT_PRDT', '01') }; };
function merge_(a, b) { for (var k in b) a[k] = b[k]; return a; }

// ── 시세 ──
KIS.priceKR = function (code) {
  var j = KIS.call('get', '/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100', { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: code });
  return Number(j.output.stck_prpr);
};
KIS.priceUS = function (sym, excd) {
  var j = KIS.call('get', '/uapi/overseas-price/v1/quotations/price', 'HHDFS00000300', { AUTH: '', EXCD: excd, SYMB: sym });
  return Number(j.output.last);
};
/** 국내 영업일 여부 (휴장일 조회, 실패 시 평일이면 true) */
KIS.isKrOpen = function (yyyymmdd) {
  var p = PropertiesService.getScriptProperties(), ck = 'hol:' + yyyymmdd, c = p.getProperty(ck);
  if (c) return c === 'Y';                                        // 문서: 1일 1회 호출 권장 → 캐시
  if (KIS.mock()) return true;                                    // 모의투자 미지원 → 평일 간주
  try {
    var j = KIS.call('get', '/uapi/domestic-stock/v1/quotations/chk-holiday', 'CTCA0903R', { BASS_DT: yyyymmdd, CTX_AREA_NK: '', CTX_AREA_FK: '' });
    var rows = j.output || []; for (var i = 0; i < rows.length; i++) if (rows[i].bass_dt === yyyymmdd) { p.setProperty(ck, rows[i].opnd_yn === 'Y' ? 'Y' : 'N'); return rows[i].opnd_yn === 'Y'; }
  } catch (e) { Logger.log('휴장일 조회 실패(평일로 간주): ' + e); }
  return true;
};
/** 국내 보유수량 (계좌 전체에서 해당 종목) */
KIS.holdingKR = function (code) {
  var rows = KIS.paged('/uapi/domestic-stock/v1/trading/inquire-balance', KIS.tr('TTTC8434R', 'VTTC8434R'), merge_(KIS.acct(), {
    AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '01', UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '00', CTX_AREA_FK100: '', CTX_AREA_NK100: '' }), 'output1', ['ctx_area_fk100', 'ctx_area_nk100']);
  var q = 0; rows.forEach(function (r) { if (r.pdno === code) q += Number(r.hldg_qty); });
  return q;
};

// ── 주문 ──  ORD_DVSN(국내): 00 지정가, 01 시장가, 06 장후시간외(시간외종가)
//             ORD_DVSN(해외): 00 지정가, 33 MOC, 34 LOC
KIS.orderKR = function (code, side, qty, price, dvsn) {
  var j = KIS.call('post', '/uapi/domestic-stock/v1/trading/order-cash',
    side === 'BUY' ? KIS.tr('TTTC0012U', 'VTTC0012U') : KIS.tr('TTTC0011U', 'VTTC0011U'),
    merge_(KIS.acct(), { PDNO: code, ORD_DVSN: dvsn, ORD_QTY: String(qty), ORD_UNPR: String(price || 0) }));
  return j.output.ODNO;
};
KIS.orderUS = function (sym, excg, side, qty, price, dvsn) {
  var j = KIS.call('post', '/uapi/overseas-stock/v1/trading/order',
    side === 'BUY' ? KIS.tr('TTTT1002U', 'VTTT1002U') : KIS.tr('TTTT1006U', 'VTTT1001U'),
    merge_(KIS.acct(), { OVRS_EXCG_CD: excg, PDNO: sym, ORD_QTY: String(qty), OVRS_ORD_UNPR: String(price || 0), CTAC_TLNO: '', MGCO_APTM_ODNO: '', SLL_TYPE: side === 'SELL' ? '00' : '', ORD_SVR_DVSN_CD: '0', ORD_DVSN: dvsn }));
  return j.output.ODNO;
};

// ── 체결 조회: 주문번호 → {qty, price} ──
KIS.fillsKR = function (yyyymmdd, code) {
  var rows = KIS.paged('/uapi/domestic-stock/v1/trading/inquire-daily-ccld', KIS.tr('TTTC0081R', 'VTTC0081R'), merge_(KIS.acct(), {
    INQR_STRT_DT: yyyymmdd, INQR_END_DT: yyyymmdd, SLL_BUY_DVSN_CD: '00', INQR_DVSN: '00', PDNO: code || '', CCLD_DVSN: '01', ORD_GNO_BRNO: '', ODNO: '',
    INQR_DVSN_3: '00', INQR_DVSN_1: '', EXCG_ID_DVSN_CD: 'KRX', CTX_AREA_FK100: '', CTX_AREA_NK100: '' }), 'output1', ['ctx_area_fk100', 'ctx_area_nk100']);
  var m = {}; rows.forEach(function (r) { var q = Number(r.tot_ccld_qty); if (q > 0 && r.cncl_yn !== 'Y') m[r.odno] = { qty: q, price: Number(r.avg_prvs) }; });
  return m;
};
KIS.fillsUS = function (yyyymmdd) {
  var mk = KIS.mock();   // 모의: PDNO/거래소 ''(전체), 구분 '00' 만 가능
  var rows = KIS.paged('/uapi/overseas-stock/v1/trading/inquire-ccnl', KIS.tr('TTTS3035R', 'VTTS3035R'), merge_(KIS.acct(), {
    PDNO: mk ? '' : '%', ORD_STRT_DT: yyyymmdd, ORD_END_DT: yyyymmdd, SLL_BUY_DVSN: '00', CCLD_NCCS_DVSN: mk ? '00' : '01', OVRS_EXCG_CD: mk ? '' : '%',
    SORT_SQN: 'DS', ORD_DT: '', ORD_GNO_BRNO: '', ODNO: '', CTX_AREA_NK200: '', CTX_AREA_FK200: '' }), 'output', ['ctx_area_fk200', 'ctx_area_nk200']);
  var m = {}; rows.forEach(function (r) { var q = Number(r.ft_ccld_qty); if (q > 0) m[r.odno] = { qty: q, price: Number(r.ft_ccld_unpr3) }; });
  return m;
};
