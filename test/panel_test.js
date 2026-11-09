// 실제 KODEX 탭 값(2026-11-08 내보내기)으로 planFromSheet_ 검증
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const grid=JSON.parse(fs.readFileSync(__dirname+'/kodex_grid.json','utf8'));
const logs=[];const ctx={console,Logger:{log:x=>logs.push(x)},PropertiesService:{getScriptProperties:()=>({getProperty:()=>null})},Utilities:{formatDate:()=>'x'}};vm.createContext(ctx);
for(const f of ['Strategy','Config','Kis','SheetIO'])vm.runInContext(fs.readFileSync(__dirname+`/../src/${f}.gs`,'utf8'),ctx);
const L=n=>{let s='';while(n>0){s=String.fromCharCode(65+(n-1)%26)+s;n=Math.floor((n-1)/26)}return s};
function mkSheet(g){return{getName:()=>'KODEX 레버리지',getMaxRows:()=>1000,getLastColumn:()=>18,
 getRange:(r,c,nr,nc)=>({getValues:()=>{const o=[];for(let i=0;i<nr;i++){const row=[];for(let j=0;j<nc;j++){const v=(g[r-1+i]||[])[c-1+j];row.push(v===undefined||v===null?'':v)}o.push(row)}return o}})}}
const mkSS=g=>({getSheets:()=>[mkSheet(g)],getSheetByName:()=>mkSheet(g)});ctx.ss_=()=>mkSS(grid);
const now={ymd:'20261109'};ctx.KIS.use=()=>{};ctx.KIS.limitsKR=()=>({upper:81250,lower:43750,base:62500});
let ts=ctx.loadTickers('KR');assert.equal(ts.length,1);const t=ts[0];
assert.equal(t.acct,'7090');assert.equal(t.code,'122630');assert.equal(t.P.N,40);assert.equal(t.P.starBase,0.12);assert.equal(t.P.revExitPct,-0.12);
let pl=ctx.planFromSheet_(t,now);
console.log(pl.tag,pl.mode,'T',pl.T0,'qty',pl.qty0,'avg',Math.round(pl.avg0),'예산',pl.budget,'별지점',pl.star);
console.log(pl.orders.map(o=>`${o.id}:${o.side}${o.kind} ${o.qty}@${o.price}`).join(' | '));
console.log('notes:',pl.notes.join(' / '),'errors:',pl.errors.join(' / '));
assert.equal(pl.tag,'R2');assert.equal(pl.mode,'R');
const sell=pl.orders.find(o=>o.group==='rsell');assert.equal(sell.qty,4);assert.equal(sell.price,66685);
const b=pl.orders.find(o=>o.group==='rbuy');assert.equal(b.qty,1);assert.equal(b.price,66680);
assert.ok(!pl.orders.find(o=>o.group==='target'));
// 하한가(43,750) 미만 줍줍 제외: 63,370 은 남고 42,245 이하는 제외
assert.deepEqual(pl.orders.filter(o=>o.side==='BUY').map(o=>o.price),[66680,63370]);assert.ok(pl.notes.some(n=>n.includes('7건 제외')));
// 조회 실패 시 필터 없이 진행 + 경고
ctx.KIS.limitsKR=()=>{throw new Error('boom')};let plx=ctx.planFromSheet_(t,now);assert.equal(plx.orders.filter(o=>o.side==='BUY').length,9);assert.ok(plx.notes.some(n=>n.includes('필터 미적용')));ctx.KIS.limitsKR=()=>({upper:81250,lower:43750,base:62500});
// 일반모드/R1 변형
const g2=JSON.parse(JSON.stringify(grid));g2[6][5]='R1';pl=ctx.planFromSheet_(t,now);
const g3=JSON.parse(JSON.stringify(grid));g3[6][5]='R1';ctx.ss_=()=>mkSS(g3);pl=ctx.planFromSheet_(ctx.loadTickers('KR')[0],now);
assert.equal(pl.orders.length,1);assert.equal(pl.orders[0].kind,'MOC');assert.equal(pl.orders[0].qty,4);assert.equal(pl.revDay0,0);
// R9 수동이면 제외
const g4=JSON.parse(JSON.stringify(grid));g4[1][17]='수동';ctx.ss_=()=>mkSS(g4);assert.equal(ctx.loadTickers('KR').length,0);
// 모드/단계 불일치 오류
const g5=JSON.parse(JSON.stringify(grid));g5[6][5]='N1';ctx.ss_=()=>mkSS(g5);assert.throws(()=>ctx.planFromSheet_(ctx.loadTickers('KR')[0],now),/맞지 않음/);
console.log('패널 읽기 테스트 통과');
