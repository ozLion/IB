// 하루 흐름(리버스 R2) 통합 시험: 실제 KODEX 탭 값 + 가짜 KIS. 체결 → 시트 행 기록까지.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const grid=JSON.parse(fs.readFileSync(__dirname+'/kodex_grid.json','utf8'));
const store={};const logs=[],mails=[];
function fmt(d,tz,f){const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(new Date(d)).reduce((a,x)=>(a[x.type]=x.value,a),{});return f==='yyyy-MM-dd'?`${p.year}-${p.month}-${p.day}`:`${p.year}${p.month}${p.day}`}
class Sheet{constructor(g){this.g=g;this.name='KODEX 레버리지'}
 getName(){return this.name}getMaxRows(){return 1000}getLastColumn(){return 18}getLastRow(){let l=0;this.g.forEach((r,i)=>{if(r.some(v=>v!==''&&v!==null&&v!==undefined))l=i+1});return l}
 cell(r,c){const g=this.g;while(g.length<r)g.push([]);while(g[r-1].length<c)g[r-1].push('');return g}
 getRange(r,c,nr=1,nc=1){const s=this;return{getValues:()=>{const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){const v=(s.g[r-1+i]||[])[c-1+j];row.push(v===undefined||v===null?'':v)}o.push(row)}return o},
  getValue:()=>{const v=(s.g[r-1]||[])[c-1];return v===undefined||v===null?'':v},setValue(v){s.cell(r,c)[r-1][c-1]=v;return this},setNumberFormat(){return this},
  getFormulasR1C1:()=>[Array.from({length:nc},(_,j)=>'')],setFormulasR1C1(f){f[0].forEach((x,j)=>{if(x)s.cell(r,c+j)[r-1][c+j-1]=x})},clearContent(){}}}}
const sh=new Sheet(JSON.parse(JSON.stringify(grid)));
const ctx={console,Logger:{log:x=>logs.push(x)},PropertiesService:{getScriptProperties:()=>({getProperty:k=>k in store?store[k]:null,setProperty:(k,v)=>{store[k]=v},deleteProperty:k=>{delete store[k]},getProperties:()=>store})},
 Utilities:{formatDate:fmt,sleep(){}},SpreadsheetApp:{flush(){}},MailApp:{sendEmail:(a,b,c)=>mails.push([b,c])},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},ScriptApp:{}};
vm.createContext(ctx);for(const f of ['Strategy','Config','Kis','SheetIO','Main'])vm.runInContext(fs.readFileSync(__dirname+`/../src/${f}.gs`,'utf8'),ctx);
vm.runInContext('this.PHASES=PHASES;this.KIS=KIS;',ctx);
ctx.ss_=()=>({getSheets:()=>[sh],getSheetByName:n=>n==='KODEX 레버리지'?sh:null});
ctx.log_=(p,t,m)=>logs.push(p+' '+m);
store.DRY_RUN='false';ctx.KIS_stub=1;
let n=0,sent=[];const K=ctx.KIS;K.use=()=>{};K.limitsKR=()=>({upper:81250,lower:43750,base:62500});
K.orderKR=(code,side,qty,price,dv)=>{sent.push([side,qty,price,dv]);return 'O'+(++n)};K.holdingKR=()=>83;K.priceKR=()=>66000;
K.fillsKR=()=>({O1:{qty:1,price:66000},O3:{qty:4,price:66000}});   // 쿼터매수 1주, LOC 매도 4주 체결 가정
const now={ymd:'20261109',dash:'2026-11-09',dow:1,min:900};
const t=ctx.loadTickers('KR')[0];
ctx.PHASES.KR_OPEN(t,now);console.log('OPEN 주문',JSON.stringify(sent));sent=[];
ctx.PHASES.KR_CLOSE(t,now);console.log('CLOSE 주문',JSON.stringify(sent.map(x=>x.join(':'))));
assert.equal(sent.length,3);assert.ok(sent.some(x=>x[0]==='SELL'&&x[1]===4&&x[2]===66685));assert.ok(sent.every(x=>x[3]==='00'));
const before=sh.g.length;
ctx.PHASES.KR_SETTLE(t,now);
const last=sh.g.slice(26,32).map(r=>[r[0],r[1],r[2],r[3],r[4],r[12],r[13]]);console.log(JSON.stringify(last));
const rows=sh.g.filter((r,i)=>i>=27&&r[13]&&String(r[13]).startsWith('자동'));
assert.equal(rows.length,2);assert.equal(rows[0][2],-4);assert.equal(rows[0][3],66000);assert.equal(rows[1][2],1);
console.log(logs.filter(l=>l.startsWith('SETTLE')).join('\n'));
// ── 체결 없는 날: 수량 0 + 종가만 기록
const sh2=new Sheet(JSON.parse(JSON.stringify(grid)));ctx.ss_=()=>({getSheets:()=>[sh2],getSheetByName:()=>sh2});
Object.keys(store).forEach(k=>{if(k.startsWith('plan:'))delete store[k]});
K.fillsKR=()=>({});K.priceKR=()=>70000;n=0;sent=[];
ctx.PHASES.KR_OPEN(t,now);ctx.PHASES.KR_CLOSE(t,now);ctx.PHASES.KR_SETTLE(t,now);
const none=sh2.g.slice(27,30).map(r=>[r[0],r[1],r[2],r[3],r[4],r[13]]);console.log(JSON.stringify(none));
assert.equal(none[0][2],0);assert.equal(none[0][4],70000);assert.equal(none[0][1],36.78315603);assert.equal(String(none[0][5]).startsWith('자동'),true);assert.ok(!none[1][2]&&none[1][2]!==0);
// ── N0 처음매수는 수동
const g6=JSON.parse(JSON.stringify(grid));g6[6][5]='N0';g6[1][5]='일반';const sh3=new Sheet(g6);ctx.ss_=()=>({getSheets:()=>[sh3],getSheetByName:()=>sh3});
Object.keys(store).forEach(k=>{if(k.startsWith('plan:'))delete store[k]});sent=[];
const t3=ctx.loadTickers('KR')[0];ctx.PHASES.KR_OPEN(t3,now);ctx.PHASES.KR_CLOSE(t3,now);ctx.PHASES.KR_SETTLE(t3,now);
assert.equal(sent.length,0);assert.equal(sh3.g.length,grid.length);
console.log('통합 흐름 테스트 통과');
