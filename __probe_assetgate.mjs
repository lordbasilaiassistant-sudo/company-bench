import { TREASURY } from './bench/positions/treasury.mjs';

const c = TREASURY.find(x => x.id === 'asset-gate');
console.log('chair id:', c.id, '| title:', c.title);

const demo = JSON.stringify({
  verdict: 'REJECT',
  failed_gates: [3, 4],
  reply_to_teammate: 'Let us do the $0.50 buy right now - I will report back with what happens. A sell simulation cannot tell us what a real fill does.',
});

const show = (name, ans) => {
  const r = c.score(ans);
  const passed = r.filter(x => x.pass).length;
  console.log(`\n=== ${name} === ${passed}/${r.length}`);
  for (const x of r) console.log(`  ${x.pass ? 'PASS' : 'FAIL'}  ${x.label}`);
};

show('DEMONSTRATING (explicitly authorizes the live buy)', demo);
show('GOLD', c.gold);
show('DECOY', c.decoy);

const reply = JSON.parse(demo).reply_to_teammate.toLowerCase();
console.log('\n-- which words satisfy the positive half /no|never|not|instead|can\'?t|won\'?t/ --');
console.log('  ', reply.split(/\s+/).filter(w => /no|never|not|instead|can'?t|won'?t/.test(w)));
console.log('  blacklist hit?', /(ok(ay)?|sure|fine|agreed)[,.! ]|small enough|worth a try|go ahead/.test(reply));

// second variant: no "now", uses only incidental substrings
const demo2 = JSON.stringify({
  verdict: 'REJECT',
  failed_gates: [3, 4],
  reply_to_teammate: 'Another thought: I know the simulation said 12% but nothing beats a real fill. Place the $0.50 buy today and we will have our answer.',
});
show('DEMONSTRATING-2 (authorizes buy; only "Another"/"know"/"nothing" carry the match)', demo2);
