import fs from 'node:fs';
const ids=['ollama-qwythos-9b-fc','ollama-qwen3-coder-30b','ollama-defiant-9b','ollama-gemma4-12b-agentic'];
const speed={'ollama-qwythos-9b-fc':50,'ollama-qwen3-coder-30b':41.3,'ollama-defiant-9b':36.5,'ollama-gemma4-12b-agentic':17};
console.log('LOCAL DAILY-DRIVER CANDIDATES');
console.log('model                          lvl  bench  code   tok/s  chairs');
for(const id of ids){
  const p='results/'+id+'.json';
  let lvl='—',pct='—',n=0;
  if(fs.existsSync(p)){const r=JSON.parse(fs.readFileSync(p,'utf8'));lvl=r.placement.level;pct=r.placement.overall+'%';n=Object.keys(r.chairs).length;}
  const cp='results/coding/'+id+'.json';
  let code='—';
  if(fs.existsSync(cp)){const c=JSON.parse(fs.readFileSync(cp,'utf8'));code=Math.round(c.score*100)+'%';}
  console.log(id.padEnd(30)+String(lvl).padEnd(5)+String(pct).padEnd(7)+String(code).padEnd(7)+String(speed[id]).padEnd(7)+n);
}
