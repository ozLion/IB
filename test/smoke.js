const fs=require('fs'),vm=require('vm');
const store={};const props={getProperty:k=>k in store?store[k]:null,setProperty:(k,v)=>{store[k]=v},deleteProperty:k=>{delete store[k]},getProperties:()=>store};
const logs=[],appended=[],stateSaved=[];
const ctx={console,Logger:{log:x=>{}},PropertiesService:{getScriptProperties:()=>props},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
 Utilities:{formatDate:(d,tz,f)=>{const p=new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(d).reduce((a,x)=>(a[x.type]=x.value,a),{});
   const dow=new Date(Date.UTC(+p.year,+p.month-1,+p.day)).getUTCDay()||7; return {'yyyyMMdd':p.year+p.month+p.day,'yyyy-MM-dd':`${p.year}-${p.month}-${p.day}`,'u':String(dow),'H':String(+p.hour),'m':String(+p.minute)}[f]},sleep(){}},
 SpreadsheetApp:{},MailApp:{sendEmail:()=>{}},ScriptApp:{}};
vm.createContext(ctx);
for(const f of ['Strategy','Config','Kis','SheetIO','Main']) vm.runInContext(fs.readFileSync(`src/${f}.gs`,'utf8'),ctx);
vm.runInContext(`this.IB=IB;this.PHASES=PHASES;this.KIS=KIS;`,ctx);
// 스텁
let SHEET={T:5,qty:100,avg:70000,cash:8000000,lastClose:70000,mode:'N',revDay:0};
Object.assign(ctx,{
 loadTickers:m=>[{tab:'KODEX',acct:'7441',code:'122630',market:'KR',excd:'',P:{market:'KR',type:'ETF',N:40,starBase:.15,targetPct:.15,revExitPct:-.15,ladderStep:1,ladderCount:5,bigPct:.12,quarterMinOne:false},topup:true}],
 readState:()=>({...SHEET}),histCloses_:()=>[70000,70500,69800,70200,70000],saveClose_(){},saveMode_:(t,m,r)=>stateSaved.push([m,r]),setLastT_(){},
 log_:(p,t,m)=>logs.push(p+' '+m),alert_:(s,b)=>logs.push('ALERT '+s+' '+b),appendRows:(t,d,c,T,r)=>appended.push({d,c,T,r}),
 isDry_:()=>false});
let n=0,sent=[];const ctxK=ctx.KIS;
ctxK.orderKR=(code,side,qty,price,dv)=>{sent.push([side,qty,price,dv]);return 'O'+(++n)};
ctxK.holdingKR=()=>100; ctxK.priceKR=()=>69000;
ctxK.fillsKR=()=>{ // 체결: 별LOC(1), 평단LOC 미체결, 줍줍 없음
  return {O2:{qty:1,price:69000}}};
const now={ymd:'20261109',dash:'2026-11-09',dow:1,min:900};
ctx.PHASES.KR_OPEN(ctx.loadTickers()[0],now);
console.log('OPEN 주문',JSON.stringify(sent)); sent=[];
ctx.PHASES.KR_CLOSE(ctx.loadTickers()[0],now); console.log('CLOSE 주문',JSON.stringify(sent)); sent=[];
ctx.PHASES.KR_SETTLE(ctx.loadTickers()[0],now); console.log('SETTLE',JSON.stringify(appended),JSON.stringify(stateSaved));
ctx.PHASES.KR_TOPUP(ctx.loadTickers()[0],now); console.log('TOPUP 주문',JSON.stringify(sent));
console.log(logs.join('\n'));
