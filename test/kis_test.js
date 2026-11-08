// KIS 래퍼 점검: UrlFetchApp 스텁으로 요청 구성(헤더/파라미터/본문)과 연속조회 확인
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const store={KIS_APP_KEY_7441:'K',KIS_APP_SECRET_7441:'S',KIS_CANO_7441:'12345678',KIS_ACNT_PRDT_CD_7441:'01',KIS_APP_KEY_9999:'K2',KIS_APP_SECRET_9999:'S2',KIS_CANO_9999:'87654321',KIS_ACNT_PRDT_CD_9999:'01'};
const calls=[]; let pageResp=[];
const ctx={console,PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in store?store[k]:null,setProperty:(k,v)=>{store[k]=v}})},Utilities:{sleep(){}},
 UrlFetchApp:{fetch:(url,opt)=>{calls.push({url,opt});
   if(url.includes('/oauth2/tokenP'))return R({access_token:'TOK',expires_in:86400});
   if(pageResp.length)return pageResp.shift();
   return R({rt_cd:'0',output:{ODNO:'0000000001'}});}}};
function R(b,h){return{getResponseCode:()=>200,getContentText:()=>JSON.stringify(b),getAllHeaders:()=>h||{}}}
vm.createContext(ctx);
for(const f of ['Config','Kis'])vm.runInContext(fs.readFileSync(`src/${f}.gs`,'utf8'),ctx);
vm.runInContext('this.KIS=KIS',ctx);const KIS=ctx.KIS;KIS.use('7441');
// 국내 주문 (실전)
KIS.orderKR('122630','BUY',3,70000,'00');let c=calls[calls.length-1];
let body=JSON.parse(c.opt.payload);
assert.equal(c.opt.headers.tr_id,'TTTC0012U');assert.equal(body.ORD_QTY,'3');assert.equal(body.ORD_UNPR,'70000');assert.equal(body.ORD_DVSN,'00');assert.ok(c.url.endsWith('/uapi/domestic-stock/v1/trading/order-cash'));
KIS.orderKR('122630','SELL',2,0,'01');body=JSON.parse(calls[calls.length-1].opt.payload);assert.equal(calls[calls.length-1].opt.headers.tr_id,'TTTC0011U');assert.equal(body.ORD_UNPR,'0');
// 해외 주문
KIS.orderUS('TQQQ','NASD','SELL',4,70.1,'34');c=calls[calls.length-1];body=JSON.parse(c.opt.payload);
assert.equal(c.opt.headers.tr_id,'TTTT1006U');assert.equal(body.SLL_TYPE,'00');assert.equal(body.ORD_DVSN,'34');assert.equal(body.OVRS_EXCG_CD,'NASD');assert.equal(body.ORD_SVR_DVSN_CD,'0');
KIS.orderUS('TQQQ','NASD','BUY',4,70.1,'34');body=JSON.parse(calls[calls.length-1].opt.payload);assert.equal(calls[calls.length-1].opt.headers.tr_id,'TTTT1002U');assert.equal(body.SLL_TYPE,'');
// 모의 TR_ID + 토큰 키 분리
store.KIS_MOCK_7441='true';KIS.orderUS('TQQQ','NASD','SELL',1,70,'00');assert.equal(calls[calls.length-1].opt.headers.tr_id,'VTTT1001U');assert.ok(calls[calls.length-1].url.includes('openapivts'));assert.ok(store.KIS_TOKEN_7441_M&&store.KIS_TOKEN_7441_R);
store.KIS_MOCK_7441='false';
// 연속조회: 1페이지(tr_cont=M) → 2페이지
pageResp=[R({rt_cd:'0',output1:[{pdno:'111111',hldg_qty:'5'}],ctx_area_fk100:'F1',ctx_area_nk100:'N1'},{tr_cont:'M'}),R({rt_cd:'0',output1:[{pdno:'122630',hldg_qty:'7'}]},{tr_cont:'D'})];
assert.equal(KIS.holdingKR('122630'),7);
const second=calls[calls.length-1];assert.equal(second.opt.headers.tr_cont,'N');assert.ok(second.url.includes('CTX_AREA_NK100=N1')&&second.url.includes('INQR_DVSN=01'));
// 체결조회 파라미터
pageResp=[R({rt_cd:'0',output1:[{odno:'0001',tot_ccld_qty:'3',avg_prvs:'70000',cncl_yn:''}]},{tr_cont:'D'})];
const f=KIS.fillsKR('20261109','122630');assert.deepEqual(JSON.parse(JSON.stringify(f)),{'0001':{qty:3,price:70000}});assert.ok(calls[calls.length-1].url.includes('EXCG_ID_DVSN_CD=KRX'));
pageResp=[R({rt_cd:'0',output:[{odno:'9',ft_ccld_qty:'2',ft_ccld_unpr3:'70.5'}]},{tr_cont:'D'})];
KIS.fillsUS('20261109');assert.ok(calls[calls.length-1].url.includes('PDNO=%25'));
store.KIS_MOCK_7441='true';pageResp=[R({rt_cd:'0',output:[]},{tr_cont:'D'})];KIS.fillsUS('20261109');assert.ok(/PDNO=&/.test(calls[calls.length-1].url)&&/CCLD_NCCS_DVSN=00/.test(calls[calls.length-1].url));
// 계정 분리: 9999 계정은 다른 키/계좌번호 사용, 누락 시 오류
KIS.use('9999');KIS.orderKR('122630','BUY',1,1000,'00');let c2=calls[calls.length-1];assert.equal(c2.opt.headers.appkey,'K2');assert.equal(JSON.parse(c2.opt.payload).CANO,'87654321');
assert.throws(()=>KIS.use('1111'),/KIS_APP_KEY_1111/);assert.throws(()=>KIS.use(''),/P9/);
console.log('KIS 요청 구성·계정 분리 테스트 통과');
