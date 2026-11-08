/** 한국투자증권 Open API 래퍼.  ※ TR_ID·필드명은 변경될 수 있으니 KIS 공식 문서와 대조해 확인하세요. */
var KIS = {};
KIS.base = function () { return String(prop_('KIS_MOCK', 'false')) === 'true' ? 'https://openapivts.koreainvestment.com:29443' : 'https://openapi.koreainvestment.com:9443'; };
KIS.mock = function () { return String(prop_('KIS_MOCK', 'false')) === 'true'; };
KIS.tr = function (real, mock) { return KIS.mock() ? mock : real; };

KIS.token = function () {
  var p = PropertiesService.getScriptProperties(), tk = p.getProperty('KIS_TOKEN'), exp = Number(p.getProperty('KIS_TOKEN_EXP') || 0);
  if (tk && Date.now() < exp - 10 * 60 * 1000) return tk;
  var res = UrlFetchApp.fetch(KIS.base() + '/oauth2/tokenP', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ grant_type: 'client_credentials', appkey: prop_('KIS_APPKEY'), appsecret: prop_('KIS_APPSECRET') })
  });
  var j = JSON.parse(res.getContentText());
  if (!j.access_token) throw new Error('KIS 토큰 발급 실패: ' + res.getContentText());
  p.setProperty('KIS_TOKEN', j.access_token);
  p.setProperty('KIS_TOKEN_EXP', String(Date.now() + (Number(j.expires_in) || 86400) * 1000));   // 토큰 재발급은 1분 1회 제한 → 반드시 캐시
  return j.access_token;
};

KIS.call = function (method, path, trId, params, retry) {
  var url = KIS.base() + path, opt = { method: method, muteHttpExceptions: true, headers: {
    'content-type': 'application/json; charset=utf-8', authorization: 'Bearer ' + KIS.token(),
    appkey: prop_('KIS_APPKEY'), appsecret: prop_('KIS_APPSECRET'), tr_id: trId, custtype: 'P' } };
  if (method === 'get') {
    url += '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  } else opt.payload = JSON.stringify(params);
  var res = UrlFetchApp.fetch(url, opt), txt = res.getContentText(), j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('KIS 응답 파싱 실패 ' + res.getResponseCode() + ' ' + txt.slice(0, 200)); }
  if (res.getResponseCode() === 500 && /초당|EGW00201/.test(txt) && !retry) { Utilities.sleep(1100); return KIS.call(method, path, trId, params, true); }  // 초당 호출 제한
  if (j.rt_cd !== undefined && j.rt_cd !== '0') throw new Error('KIS 오류 [' + trId + '] ' + j.msg_cd + ' ' + j.msg1);
  return j;
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
  try {
    var j = KIS.call('get', '/uapi/domestic-stock/v1/quotations/chk-holiday', 'CTCA0903R', { BASS_DT: yyyymmdd, CTX_AREA_NK: '', CTX_AREA_FK: '' });
    var rows = j.output || []; for (var i = 0; i < rows.length; i++) if (rows[i].bass_dt === yyyymmdd) return rows[i].opnd_yn === 'Y';
  } catch (e) { Logger.log('휴장일 조회 실패(평일로 간주): ' + e); }
  return true;
};
/** 국내 보유수량 (계좌 전체에서 해당 종목) */
KIS.holdingKR = function (code) {
  var j = KIS.call('get', '/uapi/domestic-stock/v1/trading/inquire-balance', KIS.tr('TTTC8434R', 'VTTC8434R'), merge_(KIS.acct(), {
    AFHR_FLPR_YN: 'N', OFL_YN: '', INQR_DVSN: '02', UNPR_DVSN: '01', FUND_STTL_ICLD_YN: 'N', FNCG_AMT_AUTO_RDPT_YN: 'N', PRCS_DVSN: '00', CTX_AREA_FK100: '', CTX_AREA_NK100: '' }));
  var rows = j.output1 || [], q = 0; for (var i = 0; i < rows.length; i++) if (rows[i].pdno === code) q += Number(rows[i].hldg_qty);
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
    merge_(KIS.acct(), { OVRS_EXCG_CD: excg, PDNO: sym, ORD_QTY: String(qty), OVRS_ORD_UNPR: String(price || 0), ORD_SVR_DVSN_CD: '0', ORD_DVSN: dvsn }));
  return j.output.ODNO;
};

// ── 체결 조회: 주문번호 → {qty, price} ──
KIS.fillsKR = function (yyyymmdd) {
  var j = KIS.call('get', '/uapi/domestic-stock/v1/trading/inquire-daily-ccld', KIS.tr('TTTC0081R', 'VTTC0081R'), merge_(KIS.acct(), {
    INQR_STRT_DT: yyyymmdd, INQR_END_DT: yyyymmdd, SLL_BUY_DVSN_CD: '00', INQR_DVSN: '00', PDNO: '', CCLD_DVSN: '01', ORD_GNO_BRNO: '', ODNO: '', INQR_DVSN_3: '00', INQR_DVSN_1: '', CTX_AREA_FK100: '', CTX_AREA_NK100: '' }));
  var m = {}; (j.output1 || []).forEach(function (r) { var q = Number(r.tot_ccld_qty); if (q > 0) m[r.odno] = { qty: q, price: Number(r.avg_prvs) }; });
  return m;
};
KIS.fillsUS = function (yyyymmdd) {
  var j = KIS.call('get', '/uapi/overseas-stock/v1/trading/inquire-ccnl', KIS.tr('TTTS3035R', 'VTTS3035R'), merge_(KIS.acct(), {
    PDNO: '%', ORD_STRT_DT: yyyymmdd, ORD_END_DT: yyyymmdd, SLL_BUY_DVSN: '00', CCLD_NCCS_DVSN: '01', OVRS_EXCG_CD: '%', SORT_SQN: 'DS', ORD_DT: '', ORD_GNO_BRNO: '', ODNO: '', CTX_AREA_NK200: '', CTX_AREA_FK200: '' }));
  var m = {}; (j.output || []).forEach(function (r) { var q = Number(r.ft_ccld_qty); if (q > 0) m[r.odno] = { qty: q, price: Number(r.ft_ccld_unpr3) }; });
  return m;
};
