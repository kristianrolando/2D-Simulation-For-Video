// Compare two bench JSON files (docs/evidence/bench/*.json) as a markdown table.
//   node tools/bench-compare.ts docs/evidence/bench/baseline-node.json docs/evidence/bench/after-node.json
import fs from 'node:fs';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')).results as any[]);
const pct = (x: number, y: number) => (x ? `${(((y - x) / x) * 100).toFixed(0)} %` : '');
console.log('| preset | draw p50 ms | draw p95 ms | draw max ms | full render s | RSS peak MB |');
console.log('|---|---|---|---|---|---|');
for (const r of b) {
  const o = a.find(x => x.name === r.name);
  const cell = (k: string) => (o ? `${o[k]} → ${r[k]} (${pct(o[k], r[k])})` : `new: ${r[k]}`);
  console.log(`| ${r.name} | ${cell('drawP50')} | ${cell('drawP95')} | ${cell('drawMax')} | ${cell('renderTotalSec')} | ${cell('rssPeakMB')} |`);
}
