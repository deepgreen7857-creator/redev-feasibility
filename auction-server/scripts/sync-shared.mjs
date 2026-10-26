// 화면(auction-web)의 판정 코드를 서버(functions)에서도 똑같이 쓰도록 복사한다.
//  - 서버가 매일 진행 물건을 판정해 '입찰 전 예측'을 저장하려면 화면과 같은 계산식이어야 한다.
//  - 판정 코드를 고친 뒤에는: node auction-server/scripts/sync-shared.mjs  (그다음 서버 배포)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const web = new URL('../../auction-web/src/', import.meta.url);
const out = new URL('../functions/src/shared/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = { 'lib/analyze.js': 'analyze.mjs', 'lib/tax.js': 'tax.mjs', 'lib/special.js': 'special.mjs', 'lib/valuation.js': 'valuation.mjs', 'lib/zoneMatch.js': 'zoneMatch.mjs', 'data/defaults.js': 'defaults.mjs', 'lib/bidForecast.js': 'bidForecast.mjs', 'lib/roundPlan.js': 'roundPlan.mjs', 'lib/rounds.js': 'rounds.mjs' };
for (const [src, dst] of Object.entries(files)) {
  let s = readFileSync(new URL(src, web), 'utf8');
  s = s.replace(/from '\.\/tax\.js'/g, "from './tax.mjs'").replace(/from '\.\/special\.js'/g, "from './special.mjs'").replace(/from '\.\/valuation\.js'/g, "from './valuation.mjs'")
    .replace(/from '\.\.\/data\/defaults\.js'/g, "from './defaults.mjs'").replace(/from '\.\/redevZones\.js'/g, "from './redevZones.mjs'").replace(/from '\.\/zoneMatch\.js'/g, "from './zoneMatch.mjs'").replace(/from '\.\/analyze\.js'/g, "from './analyze.mjs'").replace(/from '\.\/bidForecast\.js'/g, "from './bidForecast.mjs'");
  writeFileSync(new URL(dst, out), `// 자동 복사본 — 원본: auction-web/src/${src} (직접 고치지 말 것)\n${s}`);
  console.log(`${src} → functions/src/shared/${dst}`);
}
