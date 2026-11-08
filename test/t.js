const fs=require('fs'), vm=require('vm'); const ctx={console}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync('../src/Strategy.gs','utf8')+';this.IB=IB;',ctx); const IB=ctx.IB;
const assert=require('assert');
const P={market:'US',type:'ETF',N:20,starBase:0.15,targetPct:0.15,revExitPct:-0.15,bigPct:0.12,ladderStep:1,ladderCount:5,quarterMinOne:false};
// 가이드 수식: TQQQ 20분할 별% = 15−1.5T
assert.ok(Math.abs(IB.starPct(P,10)-0)<1e-12); assert.ok(Math.abs(IB.starPct(P,4)-0.09)<1e-12);
// 호가
assert.equal(IB.tickKR(1999,'ETF'),1); assert.equal(IB.tickKR(2000,'ETF'),5); assert.equal(IB.tickKR(25000,'STOCK'),50); assert.equal(IB.tickKR(300000,'STOCK'),500);
const K={...P,market:'KR',N:40,starBase:0.15,ladderCount:5};
// 처음매수
let pl=IB.plan(K,{mode:'N',T:0,qty:0,avg:0,cash:10_000_000,revDay:0},{prevClose:70000}); console.log(pl.tag,JSON.stringify(pl.orders));
// 전반전
pl=IB.plan(K,{mode:'N',T:5,qty:100,avg:70000,cash:8_000_000,revDay:0},{}); console.log(pl.tag,pl.star,JSON.stringify(pl.orders.map(o=>[o.group,o.side,o.kind,o.qty,o.price])));
// 랜덤 시뮬레이션 (체결 모델: LOC/ MOC=종가 체결, LIMIT 매도=고가 터치시 지정가)
function run(seed,Pp,drift){let s=seed;const r=()=>{s=(s*1664525+1013904223)%4294967296;return s/4294967296};const g=()=>{let u=r()||1e-9,v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)};
 let S={mode:'N',T:0,qty:0,avg:0,cash:10_000_000,revDay:0},cost=0,px=70000,closes=[px],seen={};
 for(let d=0;d<500;d++){px=Math.max(5000,IB.rnd(Pp,px*(1+drift+0.035*g())));const hi=px*(1+Math.abs(g()*0.012));
  const pl=IB.plan(Pp,S,{prevClose:closes[closes.length-1],closes}); seen[S.mode+pl.tag]=1;
  if(pl.errors.length){ /* 수량0 오류 → 해당 일 주문 생략 */ }
  const fills={}; let sellQ=0;
  for(const o of pl.orders){let f=null;
   if(o.side==='BUY'&&o.kind==='LOC'&&px<=o.price)f={qty:o.qty,price:px};
   if(o.side==='SELL'&&o.kind==='LOC'&&px>=o.price)f={qty:o.qty,price:px};
   if(o.kind==='MOC')f={qty:o.qty,price:px};
   if(o.kind==='LIMIT'&&hi>=o.price)f={qty:o.qty,price:o.price};
   if(f){fills[o.id]=f}}
  // 자금/수량 검증: 매도 합 ≤ 보유, 매수 금액 ≤ 현금
  let bq=0,ba=0,sq=0,sa=0;for(const o of pl.orders){const f=fills[o.id];if(!f)continue;if(o.side==='BUY'){bq+=f.qty;ba+=f.qty*f.price}else{sq+=f.qty;sa+=f.qty*f.price}}
  assert.ok(sq<=S.qty,'sell>qty '+JSON.stringify([seed,d,sq,S.qty]));
  assert.ok(ba<=S.cash+sa+1e-6,'buy>cash');
  const avgBefore=S.qty?cost/S.qty:0; cost-=avgBefore*sq; S.qty-=sq; S.cash+=sa; cost+=ba; S.qty+=bq; S.cash-=ba; S.avg=S.qty?cost/S.qty:0;
  const R=IB.apply(Pp,{...S,T:pl.T0,mode:pl.mode,revDay:pl.revDay0},pl,fills,px,S.qty,S.avg);
  S.T=R.T;S.mode=R.mode;S.revDay=R.revDay; closes.push(px);
  assert.ok(S.T>=0&&S.T<=Pp.N+1e-9&&S.qty>=0&&S.cash>=-1e-6,'inv '+JSON.stringify([seed,d,S]));
  if(S.qty===0){cost=0;S.avg=0}
 } return seen;}
const all={};for(let sd=1;sd<=300;sd++)for(const Pp of [K,{...K,N:20},{...P,market:'US',N:40,starBase:.2,targetPct:.2,revExitPct:-.2}]) Object.assign(all,run(sd,Pp,[-0.002,0,0.002][sd%3]));
console.log('시뮬 OK, 관측 케이스:',Object.keys(all).sort().join(', '));
