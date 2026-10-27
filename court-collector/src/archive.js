// 원본 보관 폴더 찾기 — 외장하드를 다른 PC(석남동 일체형 등)로 옮겨도 드라이브 문자와 상관없이 이어지게 한다.
//  1) .env 의 ORIGINALS_DIR 이 있으면 그것
//  2) 아무 드라이브에서나 <드라이브>:\법원경매원본\경매원본표식.txt 가 있는 곳(외장하드에 이 파일을 한 번 만들어 두면 됨)
//  3) 표식이 없으면 예전대로 D:\법원경매원본
//  4) 그것도 없으면 null → 각 수집기가 state 폴더에 둔다(시험용 PC)
import fs from 'node:fs';
import path from 'node:path';

export const ARCHIVE_NAME = '법원경매원본';
export const MARKER = '경매원본표식.txt';

export function findArchive(env = {}) {
  if (env.ORIGINALS_DIR && fs.existsSync(env.ORIGINALS_DIR)) return path.resolve(env.ORIGINALS_DIR);
  if (process.platform === 'win32') {
    for (const L of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const dir = `${L}:\\${ARCHIVE_NAME}`;
      try { if (fs.existsSync(path.join(dir, MARKER))) return dir; } catch { /* 빈 드라이브 등 */ }
    }
  }
  const old = `D:\\${ARCHIVE_NAME}`;
  return fs.existsSync(old) ? old : null;
}
