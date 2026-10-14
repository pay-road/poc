/* Payroad POC: shared mock data and flow logic.
   Used by dashboard.html (the shop) and inbox.html, sign.html, pay.html (what the driver gets).
   No backend: the data lives in this browser's localStorage so the pages see each other's changes
   (open them from the same server, e.g. http://localhost:8765). Sample data is rebuilt each new day.
   The flow: work order -> driver signs -> invoice -> money code payment -> close the day -> 6:00 am deposit. */
(function(){
  "use strict";
  var LS="payroad-poc", VER=4;
  var TZ="America/Chicago", TZL="CT", SHOP="Sample Truck & Tire";

  /* ---------- helpers ---------- */
  var r2=function(n){return Math.round(n*100)/100};
  var money=function(n){return (n||0).toLocaleString("en-US",{style:"currency",currency:"USD"})};
  var esc=function(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})};
  var key=function(d){return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
  var addDays=function(d,n){var x=new Date(d);x.setDate(x.getDate()+n);return x};
  var addMin=function(d,m){return new Date(d.getTime()+m*60000)};
  var at=function(d,h,m){var x=new Date(d);x.setHours(h,m||0,0,0);return x};
  var fromKey=function(k){return new Date(k+"T00:00")};
  var time=function(d){return d.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}).toLowerCase()};
  var shortDate=function(d){return d.toLocaleDateString("en-US",{month:"short",day:"numeric"})};
  var longDate=function(d){return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"})};
  var stamp=function(d){return longDate(d)+", "+time(d)};
  /* The shop's clock: every date is wall-clock time in the shop's time zone (San Antonio and Converse are Central). */
  function NOW(){return new Date(new Date().toLocaleString("en-US",{timeZone:TZ}))}
  function dayWord(d){
    var n=NOW(), k=key(d);
    if(k===key(n)) return "today";
    if(k===key(addDays(n,1))) return "tomorrow";
    if(k===key(addDays(n,-1))) return "yesterday";
    return longDate(d);
  }
  function sum(a,f){return r2(a.reduce(function(s,x){return s+(f?f(x):x)},0))}
  function mask(c){return "••"+String(c).slice(-4)}
  function contactMask(c){return /@/.test(c)?String(c).replace(/^(.).*(@.*)$/,"$1•••$2"):"•••-"+String(c).replace(/\D/g,"").slice(-4)}
  function randDigits(rand){return String(Math.floor(1e9+(rand||Math.random)()*8.9e9))}
  function validReach(c){return /@/.test(c)?/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c):c.replace(/\D/g,"").length>=10}
  function rng(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;var t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
  function fakeSig(r){
    var x=20,d="M"+x+" "+(50+r()*20);
    for(var i=0;i<5;i++){x+=45+r()*15;d+=" Q "+(x-25)+" "+(10+r()*70)+" "+x+" "+(30+r()*40)}
    return "data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 100"><path d="'+d+'" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/></svg>');
  }

  var STATES=["AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
  var FAILS={"00":"Money code not valid for this transaction","11":"Amount is more than the code allows","22":"Code already used"};
  var DEFAULT_TERMS="WORK AUTHORIZATION & SERVICE AGREEMENT / AUTORIZACIÓN DE TRABAJO Y ACUERDO DE SERVICIO\n\n1. SCOPE OF WORK / ALCANCE DEL TRABAJO\nI authorize the shop to perform the work described in this work order on my vehicle.\nAutorizo al taller a realizar el trabajo descrito en esta orden en mi vehículo.\n\n2. ROADSIDE REPAIRS / REPARACIONES EN CARRETERA\nRoadside repairs may be temporary. / Las reparaciones en carretera pueden ser temporales.\n\n3. RATES / TARIFAS\nWork is billed at the shop's posted rates. / El trabajo se cobra según las tarifas del taller.\n\n4. PAYMENT / PAGO\nPayment is due on completion. A 3% fee applies to money code payments. The vehicle may be held until the invoice is paid.\nEl pago se debe al terminar. Se aplica un cargo de 3% a pagos con money code. El vehículo puede retenerse hasta el pago total.\n\n[Sample terms. Replace with the shop's own.]";

  /* ---------- the data ---------- */
  var db={S:null,USERS:null,LOCS:null,CUST:null,RATES:null}, last="";
  function S(){return db.S}
  function userName(id){return (db.USERS.filter(function(u){return u.id===id})[0]||{}).name||""}
  function locName(id){var l=db.LOCS.filter(function(x){return x.id===id})[0];return l?l.name:""}
  function cust(id){return db.CUST.filter(function(c){return c.id===id})[0]}
  function custByName(n){n=String(n).trim().toLowerCase();return db.CUST.filter(function(c){return c.name.toLowerCase()===n})[0]}
  function wo(id){return db.S.wos.filter(function(w){return w.id===id})[0]}
  function woByNo(no){no=String(no).replace(/^WO-/i,"");return db.S.wos.filter(function(w){return w.no==="WO-"+no})[0]}
  function pay(id){return db.S.payments.filter(function(p){return p.id===id})[0]}
  function payByTxn(t){t=String(t).replace(/^PR-/i,"");return db.S.payments.filter(function(p){return p.txn==="PR-"+t})[0]}
  function woOf(p){return p?wo(p.wo):null}
  function payOf(w){return w&&w.pay?pay(w.pay):null}
  function ev(o,when,text,kind){o.events.push({at:when,text:text,kind:kind||""})}
  function subtotal(w){return sum(w.lines,function(l){return l.q*l.u})}
  function total(p){return r2(p.amount+p.conv)}
  function net(p){return r2(total(p)-p.fee)}
  function signUrl(w){return "sign.html?wo="+w.no.replace("WO-","")}
  function payUrl(p){return "pay.html?t="+p.txn.replace("PR-","")}

  /* Messages the driver receives (email or text). inbox.html shows them. */
  function msg(kind,to,o,when){
    var s=db.S; s.nM=(s.nM||0)+1;
    s.msgs.push({id:s.nM,kind:kind,to:to,ch:/@/.test(to)?"email":"sms",wo:o.wo||null,pay:o.pay||null,at:when||NOW()});
  }

  /* ---------- lifecycle ---------- */
  function newWo(o,when){
    var s=db.S; s.nW++;
    var w={id:s.nW,no:"WO-"+(578400+s.nW),cust:o.cust,pc:o.pc||"",pr:o.pr||"",driver:o.driver,dr:o.dr,unit:o.unit||"",loc:o.loc,desc:o.desc,
      via:o.via,clerk:o.clerk,created:when,status:"sent",signedAt:null,signer:"",sig:null,sigVia:"",lines:[],invAt:null,pay:null,events:[]};
    ev(w,when,"Created by "+userName(o.clerk));
    if(o.via==="link"){ev(w,when,"Sent to "+o.driver+" at "+contactMask(o.dr)+" for signature");msg("wo",o.dr,{wo:w.id},when)}
    s.wos.push(w); return w;
  }
  function resendWo(w){var n=NOW();ev(w,n,"Link resent to "+contactMask(w.dr));msg("wo",w.dr,{wo:w.id},n)}
  function signWo(w,when,signer,sig,via){
    w.status="signed"; w.signedAt=when; w.signer=signer; w.sig=sig; w.sigVia=via;
    ev(w,when,"Signed by "+signer+(via==="device"?" on the shop's device":" from the link"));
  }
  function invoiceWo(w,when,via,clerk){
    var s=db.S; s.nP++;
    var a=subtotal(w), c=cust(w.cust);
    var p={id:s.nP,txn:"PR-"+(10400+s.nP),wo:w.id,via:via,type:"",src:"",check:"",code:"",amount:a,conv:s.convOn?r2(a*s.convRate/100):0,fee:0,
      driver:w.driver,carrier:c?c.name:"",contact:w.dr,dl:"",dlState:"TX",job:w.desc,clerk:clerk,loc:w.loc,created:when,day:null,
      status:"sent",reason:"",paidAt:null,closedAt:null,depAt:null,events:[]};
    w.status="invoiced"; w.invAt=when; w.pay=p.id;
    ev(w,when,"Invoice "+p.txn+" for "+money(total(p))+(via==="link"?" sent to "+contactMask(w.dr):" created"));
    ev(p,when,"Invoice for "+money(a)+(p.conv?" + "+money(p.conv)+" money code fee":"")+(via==="link"?", sent to "+contactMask(w.dr):""));
    s.payments.push(p);
    if(via==="link") msg("invoice",w.dr,{wo:w.id,pay:p.id},when);
    return p;
  }
  function sendInvoice(p){var n=NOW(),w=woOf(p);p.via="link";ev(p,n,"Invoice sent to "+contactMask(p.contact));ev(w,n,"Invoice sent to "+contactMask(p.contact));msg("invoice",p.contact,{wo:w.id,pay:p.id},n)}
  function resendReceipt(p){var n=NOW();ev(p,n,"Receipt resent to "+contactMask(p.contact));msg("receipt",p.contact,{wo:p.wo,pay:p.id},n)}
  function setCheck(p,type,src,num,when,by){
    if(p.type&&p.type!==type) ev(p,when,"Switched from "+p.type+" to "+type);
    var changed=num!==p.check;
    p.type=type; p.src=src; p.check=num;
    if(changed){
      ev(p,when,src==="echeck"?type+" e-check #"+num+" sent to "+contactMask(p.contact):type+" check #"+num+(by==="driver"?" entered by the driver":" from the driver"));
      if(src==="echeck") msg("echeck",p.contact,{wo:p.wo,pay:p.id},when);
    }
    if(p.status==="sent") p.status="waiting";
  }
  function batchDay(){var t=at(NOW(),0);return db.S.closed[key(t)]?addDays(t,1):t}
  function approve(p,when){
    var s=db.S;
    p.fee=r2(total(p)*s.feeRate/100); p.paidAt=when; p.reason="";
    ev(p,when,"Charged "+money(total(p))+" · approved by "+(p.type==="EFS"?"EFS":"Comdata"));
    ev(p,when,"Receipt sent to "+contactMask(p.contact)); msg("receipt",p.contact,{wo:p.wo,pay:p.id},when);
    var w=woOf(p); if(w){w.status="paid";ev(w,when,"Paid "+money(total(p))+" with "+p.type+" express code")}
    if(s.pro&&key(when)===key(NOW())){
      p.status="instant"; p.day=key(when); p.depAt=when;
      s.deposits.push({id:"D"+s.deposits.length,day:p.day,at:when,closedAt:null,ids:[p.id],status:"deposited",instant:true});
      ev(p,when,"Paid instantly to Checking •••• 4821");
    }else{
      p.status="approved";
      var t=at(when,0), c=s.closed[key(t)];
      p.day=key(c&&c<=when?addDays(t,1):t);
    }
  }
  function closeBatch(list,when){
    var s=db.S, payAt=at(addDays(when,1),6), st=payAt<=NOW()?"deposited":"scheduled";
    list.forEach(function(p){
      p.status=st; p.closedAt=when; p.depAt=payAt; ev(p,when,"Day closed");
      if(st==="deposited") ev(p,payAt,"Deposited to Checking •••• 4821");
    });
    s.closed[key(when)]=when;
    if(list.length) s.deposits.push({id:"D"+s.deposits.length,day:key(when),at:payAt,closedAt:when,ids:list.map(function(p){return p.id}),status:st,instant:false});
  }
  function openBatch(){var k=key(batchDay());return db.S.payments.filter(function(p){return p.status==="approved"&&p.day===k})}
  function payAction(){return db.S.payments.filter(function(p){return p.status==="sent"||p.status==="waiting"||p.status==="failed"})}
  function woAction(){return db.S.wos.filter(function(w){return w.status==="sent"||w.status==="signed"})}
  function depPays(d){return d.ids.map(pay)}
  function depTotals(d){var ps=depPays(d);return {gross:sum(ps,function(p){return p.amount}),conv:sum(ps,function(p){return p.conv}),fees:sum(ps,function(p){return p.fee}),net:sum(ps,net),count:ps.length}}
  function cancelWo(w,who){var n=NOW(),p=payOf(w);w.status="canceled";ev(w,n,"Canceled by "+who,"bad");if(p&&!p.paidAt){p.status="canceled";ev(p,n,"Canceled by "+who,"bad")}}

  /* Charges an express code (simulated). Shared by the shop's counter and the driver's pay page.
     Codes ending in 00, 11 or 22 fail so every result can be shown. */
  function chargeCode(p,code,dl,st,by,done){
    p.code=code; p.dl="•••• "+dl.slice(-4); p.dlState=st;
    ev(p,NOW(),"Express code "+mask(code)+" entered"+(by==="driver"?" by the driver":"")+(p.status==="failed"?" (new code)":""));
    p.status="verifying"; save();
    var id=p.id;
    setTimeout(function(){
      var q=pay(id)||p, fail=FAILS[code.slice(-2)], t=NOW();
      if(fail){q.status="failed";q.reason=fail;ev(q,t,"Failed: "+fail,"bad")}else approve(q,t);
      save(); done(fail||null,q);
    },1400);
  }

  function label(p){
    switch(p.status){
      case "sent": return p.via==="link"?"Invoice sent to driver":"Ready to charge";
      case "waiting": return "Waiting for express code";
      case "verifying": return "Charging";
      case "approved": return p.day===key(NOW())?"Paid · tonight's batch":"Paid · "+dayWord(fromKey(p.day))+"'s batch";
      case "scheduled": return "Deposit "+dayWord(p.depAt)+", 6:00 am";
      case "deposited": return "Deposited "+shortDate(p.depAt);
      case "instant": return "Paid instantly";
      case "failed": return "Payment failed";
      default: return "Canceled";
    }
  }

  /* ---------- sample data ---------- */
  function seed(){
    var r=rng(4821), now=NOW(), today=at(now,0);
    var pick=function(a){return a[Math.floor(r()*a.length)]};
    db.USERS=[{id:"u1",name:"Maria R.",role:"Admin"},{id:"u2",name:"Luis G.",role:"Clerk"}];
    db.LOCS=[{id:"sat",name:"San Antonio, TX",tz:"Central Time"},{id:"cnv",name:"Converse, TX",tz:"Central Time"}];
    db.RATES=[{d:"Shop labor",u:189,per:"hr"},{d:"Diagnostics",u:249,per:"hr"},{d:"Programming",u:249,per:"hr"},
      {d:"Roadside, day",u:225,per:"hr"},{d:"Roadside, after hours",u:285,per:"hr"},{d:"Minimum road call",u:350,per:"each"},
      {d:"Mileage",u:2.48,per:"mile"},{d:"National fleet labor",u:245,per:"hr"},{d:"Parts run",u:189,per:"each"},{d:"Tire labor",u:189,per:"each"},
      {d:"Storage, up to 25 ft",u:25,per:"day"},{d:"Storage, over 25 ft",u:40,per:"day"}];
    var ph=function(){return "(210) 555-01"+String(10+Math.floor(r()*89))};
    db.CUST=[
      {id:"c1",name:"Sample Freight Co.",kind:"Carrier",pc:"Dispatch, A. Reyes",pr:ph(),notes:"",drivers:[]},
      {id:"c2",name:"Sample Fleet Leasing",kind:"Fleet",pc:"Breakdown desk",pr:"breakdowns@samplefleet.example",notes:"National fleet rate $245/hr",drivers:[]},
      {id:"c3",name:"Sample Haul LLC",kind:"Carrier",pc:"J. Ortega",pr:ph(),notes:"",drivers:[]},
      {id:"c4",name:"Sample Brokerage Inc.",kind:"Broker",pc:"After-hours line",pr:ph(),notes:"PO required",drivers:[]},
      {id:"c5",name:"Sample Logistics",kind:"Carrier",pc:"",pr:"",notes:"",drivers:[]}
    ];
    ["J. Martinez","R. Lopez","D. Smith","A. Johnson","M. Garcia","T. Brown","L. Hernandez","K. Davis","S. Ramirez","P. Wilson","E. Torres","C. Moore"]
      .forEach(function(n,i){db.CUST[i%5].drivers.push({name:n,reach:ph()})});
    db.S={v:VER,seededOn:key(now),clerk:false,pro:false,feeRate:3,convOn:true,convRate:3,terms:DEFAULT_TERMS,wos:[],payments:[],deposits:[],msgs:[],closed:{},nW:0,nP:0,nM:0,
       wf:{status:"all",q:"",from:"",to:"",loc:"all"},pf:{status:"all",q:"",from:"",to:"",loc:"all"},df:{from:"",to:""},cq:""};
    var JOBS=[["Steer tire replacement, roadside","Roadside, day",[1,2],[380,620],1],["Brake chamber replacement","Shop labor",[1,2],[90,180],0],
      ["Air line repair","Shop labor",[.5,1.5],[20,60],0],["Diagnostics, check engine light","Diagnostics",[1,2],[0,0],0],
      ["Jump start, roadside","Minimum road call",[1,1],[0,0],1],["Trailer light repair","Shop labor",[.5,1.5],[25,80],0],
      ["Drive tire, used","Tire labor",[1,1],[220,320],0],["Alternator replacement","Shop labor",[2,3],[280,460],0],
      ["Mud flap and bracket","Shop labor",[.5,1],[40,90],0],["Tire repair, roadside after hours","Roadside, after hours",[1,2],[30,90],1]];
    function lines(j){
      var rate=db.RATES.filter(function(x){return x.d===j[1]})[0], h=j[2][0]+Math.round(r()*((j[2][1]-j[2][0])*2))/2, out=[{d:rate.d,q:h,u:rate.u}];
      if(j[3][1]) out.push({d:"Parts",q:1,u:r2(j[3][0]+r()*(j[3][1]-j[3][0]))});
      if(j[4]) out.push({d:"Mileage",q:10+Math.floor(r()*30),u:2.48});
      return out;
    }
    function mk(when,stage,o){
      var c=pick(db.CUST), d=pick(c.drivers), j=pick(JOBS), clerk=r()<.6?"u1":"u2", via=r()<.7?"link":"device";
      var w=newWo({cust:c.id,pc:c.pc,pr:c.pr,driver:d.name,dr:d.reach,unit:"Unit "+(1000+Math.floor(r()*8999)),loc:r()<.65?"sat":"cnv",desc:j[0],via:via,clerk:clerk},when);
      if(stage==="sent") return {w:w};
      var sAt=addMin(when,5+Math.floor(r()*15)); if(sAt>now) sAt=now;
      signWo(w,sAt,d.name,fakeSig(r),via);
      if(stage==="signed") return {w:w};
      var iAt=addMin(sAt,30+Math.floor(r()*90)); if(iAt>now) iAt=now;
      w.lines=lines(j);
      var pvia=r()<.5?"link":"counter", p=invoiceWo(w,iAt,pvia,clerk);
      if(stage==="invoiced") return {w:w,p:p};
      var cAt=addMin(iAt,3+Math.floor(r()*20)); if(cAt>now) cAt=now;
      setCheck(p,r()<.55?"EFS":"Comchek",r()<.5?"echeck":"driver",randDigits(r),cAt,pvia==="link"?"driver":"shop");
      if(stage==="waiting") return {w:w,p:p};
      p.dl="•••• "+(1000+Math.floor(r()*8999)); p.dlState=pick(["TX","TX","TX","NM","OK","LA","AZ"]);
      var code=randDigits(r);
      if(o&&o.fail){
        ev(p,addMin(cAt,4),"Express code "+mask(code)+" entered");p.code=code;p.status="failed";p.reason=o.fail;ev(p,addMin(cAt,4),"Failed: "+o.fail,"bad");
        if(stage==="failed") return {w:w,p:p};
        code=randDigits(r);
      }
      if(stage==="canceled"){cancelWo(w,userName(clerk));return {w:w,p:p}}
      var pAt=addMin(cAt,o&&o.fail?12:6); if(pAt>now) pAt=now;
      p.code=code; ev(p,pAt,"Express code "+mask(code)+" entered"+(o&&o.fail?" (new code)":""));
      approve(p,pAt);
      return {w:w,p:p};
    }
    for(var i=13;i>=1;i--){
      var d=addDays(today,-i), k=3+Math.floor(r()*5), paid=[];
      for(var m=0;m<k;m++){
        var w0=at(d,7+Math.floor(r()*11),Math.floor(r()*60)), x=r();
        if(x<.06){mk(w0,"canceled",{fail:FAILS["00"]});continue}
        paid.push(mk(w0,"paid",x<.14?{fail:FAILS["11"]}:null).p);
      }
      closeBatch(paid,at(d,21+Math.floor(r()*3),Math.floor(r()*60)));
    }
    var start=at(today,6,30);
    ["paid","paid","sent","signed","invoiced","paid","waiting","failed","signed","paid","sent"].forEach(function(st,m){
      var t=addMin(now,-(m*37+25)); if(t<start) t=addMin(start,m); if(t>now) t=new Date(now);
      mk(t,st,st==="failed"?{fail:FAILS["11"]}:null);
    });
    // Keep only recent messages so the driver inbox stays readable.
    db.S.msgs=db.S.msgs.filter(function(x){return x.at>=addDays(today,-1)});
  }

  /* ---------- persistence ---------- */
  var ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
  function save(){
    try{var s=JSON.stringify(db);if(s!==last){localStorage.setItem(LS,s);last=s}}catch(e){}
  }
  function load(){
    try{
      var s=localStorage.getItem(LS);
      if(s){
        var d=JSON.parse(s,function(k,v){return typeof v==="string"&&ISO.test(v)?new Date(v):v});
        if(d&&d.S&&d.S.v===VER&&d.S.seededOn===key(NOW())){db.S=d.S;db.USERS=d.USERS;db.LOCS=d.LOCS;db.CUST=d.CUST;db.RATES=d.RATES;last=s;return}
      }
    }catch(e){}
    seed(); save();
  }
  function reset(){seed();save()}
  /* Forgets the saved data (used on sign out) so the next page load starts from fresh sample data. */
  function clear(){try{localStorage.removeItem(LS)}catch(e){}last=""}
  /* Calls fn when another page (tab) changes the data. */
  function onExternalChange(fn){window.addEventListener("storage",function(e){if(e.key===LS){load();fn()}})}

  window.PR={db:db,TZ:TZ,TZL:TZL,SHOP:SHOP,STATES:STATES,FAILS:FAILS,DEFAULT_TERMS:DEFAULT_TERMS,
    r2:r2,money:money,esc:esc,key:key,addDays:addDays,addMin:addMin,at:at,fromKey:fromKey,time:time,shortDate:shortDate,longDate:longDate,stamp:stamp,
    NOW:NOW,dayWord:dayWord,sum:sum,mask:mask,contactMask:contactMask,randDigits:randDigits,validReach:validReach,
    userName:userName,locName:locName,cust:cust,custByName:custByName,wo:wo,woByNo:woByNo,pay:pay,payByTxn:payByTxn,woOf:woOf,payOf:payOf,ev:ev,
    subtotal:subtotal,total:total,net:net,signUrl:signUrl,payUrl:payUrl,msg:msg,
    newWo:newWo,resendWo:resendWo,signWo:signWo,invoiceWo:invoiceWo,sendInvoice:sendInvoice,resendReceipt:resendReceipt,setCheck:setCheck,
    batchDay:batchDay,approve:approve,closeBatch:closeBatch,openBatch:openBatch,payAction:payAction,woAction:woAction,depPays:depPays,depTotals:depTotals,
    cancelWo:cancelWo,chargeCode:chargeCode,label:label,load:load,save:save,reset:reset,clear:clear,onExternalChange:onExternalChange};
  load();
})();
