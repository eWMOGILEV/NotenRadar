// Run with: node --test tests/model.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
for (const [, mode, encoded] of source.matchAll(/"(desktop|mobile)":"([A-Za-z0-9+/=]+)"/g)) {
  const html = Buffer.from(encoded, 'base64').toString();
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
  function model() {
    const context = vm.createContext({
      crypto: webcrypto, window: {}, document: {},
      localStorage: { getItem: () => null, setItem() {} },
      matchMedia: () => ({ matches: false }),
    });
    vm.runInContext(script.slice(0, script.indexOf('const tweens')) + '\n' +
      script.match(/function targetValue[^\r\n]+/)[0] + '\n' +
      script.match(/function planProjection[^\r\n]+/)[0], context);
    return code => vm.runInContext(code, context);
  }

  test(`${mode}: old collections retain notes and default to 2:1`, () => {
    const run = model();
    const result = JSON.parse(run(`JSON.stringify(validateFile({version:1,subject:'Mathe',
      appearance:defaults().appearance,limit:'9/2',inclusive:false,
      grades:[{value:5,kind:SA,weight:'1',label:'A'},{value:3,kind:KL,weight:'1',label:'B'}]}))`));
    assert.equal(result.grades.length, 2);
    assert.deepEqual(result.weighting, { sa: '2', kl: '1' });
    assert.equal(result.grades[0].date, '');
    assert.equal(result.archives.length, 0);
  });

  test(`${mode}: weighted score, exact comparisons and truncated display`, () => {
    const run = model();
    assert.equal(run(`total([{value:5,kind:SA,weight:'1'},{value:3,kind:KL,weight:'1'}],{sa:'60',kl:'40'}).toString()`), '21/5');
    assert.equal(run(`fmt(new Rational(13,3))`), '4,33');
    assert.equal(run(`meets(new Rational(9,2),'9/2',false)`), false);
    assert.equal(run(`meets(new Rational(9,2),'9/2',true)`), true);
  });

  test(`${mode}: risk bounds match direct projections for different weightings`, () => {
    const run = model();
    // Compare the analytic result with each exact projected score; no float oracle.
    assert.equal(run(`(() => {
      for(const weights of [{sa:'2',kl:'1'},{sa:'1',kl:'1'},{sa:'60',kl:'40'},{sa:'1/2',kl:'3'}]) {
        state.weighting=weights;
        for(const sa of [2,4,6])for(const kl of [1,3,5])for(const kind of [SA,KL])
        for(const grade of [1,3,6])for(const inclusive of [true,false]) {
          const grades=[{kind:SA,value:sa,weight:'3/2'},{kind:KL,value:kl,weight:'2'}];
          const b=bounds(grades,kind,grade,'1','9/2',inclusive);
          const now=meets(total(grades),'9/2',inclusive);
          for(let n=0;n<=40;n++) {
            const actual=meets(projection(grades,kind,grade,n),'9/2',inclusive);
            const predicted=now ? b.maximum===null||BigInt(n)<=b.maximum : b.minimum!==null&&BigInt(n)>=b.minimum;
            if(actual!==predicted)throw Error(JSON.stringify({weights,sa,kl,kind,grade,inclusive,n}));
          }
        }
      }
      return true;
    })()`), true);
  });

  test(`${mode}: archives, dates, scenarios and weighting survive repeated export/import`, () => {
    const run = model();
    assert.equal(run(`(() => {
      const single=defaults();single.subject='Mathe';single.weighting={sa:'3',kl:'2'};
      single.grades=[{id:uid(),value:2,kind:SA,weight:'1',label:'Arbeit',date:'2026-11-10'}];
      single.appointments=[{kind:KL,date:'2026-11-20',label:'Test'}];
      single.plan={...single.plan,useMixed:true,mixed:[{kind:KL,value:4}]};
      single.scenarios=[{name:'Realistisch',plan:cloneExtras(single.plan)}];
      state=makeCollection(single);state.periodName='Halbjahr 1';
      const archived=exportData();archived.archives=[];
      state.archives=[{name:'Vorjahr',data:archived}];
      for(let i=0;i<5;i++)state=validateFile(JSON.parse(JSON.stringify(exportData())));
      return state.periodName==='Halbjahr 1'&&state.archives[0].data.version===2&&
        state.grades[0].date==='2026-11-10'&&state.weighting.sa==='3'&&
        state.appointments[0].date==='2026-11-20'&&state.scenarios[0].plan.mixed[0].value===4;
    })()`), true);
  });

  test(`${mode}: individual planning replaces grouped counts and keeps exact scores`, () => {
    const run = model();
    assert.equal(run(`(() => {
      state.weighting={sa:'1',kl:'1'};
      state.grades=[{kind:SA,value:5,weight:'1'},{kind:KL,value:3,weight:'1'}];
      state.plan={...defaults().plan,saCount:99,klCount:99,useMixed:true,
        mixed:[{kind:SA,value:2},{kind:SA,value:4},{kind:KL,value:1}]};
      return planProjection(6,6).toString();
    })()`), '17/6');
    assert.equal(run(`planProjection(1,1,true).toString()`), '13/6');
    assert.equal(run(`planProjection(6,6,true).toString()`), '61/12');
  });

  test(`${mode}: invalid dates, weights and oversized plans are rejected`, () => {
    const run = model();
    for (const code of [
      `validDate('2026-02-30')`, `validDate('2026-13-01')`,
      `validateSubjectFile({...defaults(),weighting:{sa:'0',kl:'1'}})`,
      `validateSubjectFile({...defaults(),plan:{...defaults().plan,mixed:Array(201).fill({kind:SA,value:3})}})`,
      `validateFile({version:2,subjects:[],active_subject:'missing'})`,
    ]) assert.throws(() => run(code));
  });
}
