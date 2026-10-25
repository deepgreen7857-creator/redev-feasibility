// 물건 수천 건 판정처럼 오래 걸리는 계산을 400건씩 나눠 돌리고 사이사이 화면을 그린다(브라우저가 멈추지 않게)
import { useEffect, useState } from 'react';
export function useChunkedMap(list, fn, deps, size = 400) {
  const [out, setOut] = useState(null);
  const [prog, setProg] = useState(null);
  useEffect(() => {
    setOut(null);
    if (!list) return undefined;
    const acc = []; let i = 0; let stop = false;
    const step = () => {
      if (stop) return;
      const end = Math.min(list.length, i + size);
      for (; i < end; i++) acc.push(fn(list[i]));
      if (i < list.length) { setProg({ done: i, total: list.length }); setTimeout(step, 0); } else { setProg(null); setOut(acc); }
    };
    step();
    return () => { stop = true; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [out, prog];
}
