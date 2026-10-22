// 빌드 결과(dist)를 저장소의 auction/ 폴더(jbslab.co.kr/auction)로 복사한다.
import { cpSync, rmSync } from 'node:fs';
const src = new URL('../dist/', import.meta.url);
const dst = new URL('../../auction/', import.meta.url);
rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });
console.log('dist → ../auction 복사 완료. 이제 저장소 루트에서 git add/commit/push 하세요.');
