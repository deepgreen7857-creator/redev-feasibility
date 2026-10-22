// 사람이 조회하는 속도보다 느리게: 화면마다 20~45초(무작위) 쉬고, 30화면마다 4~10분 쉰다(config.json). 하루 화면 수·시간대 제한.
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
export const kstDay = () => kstNow().toISOString().slice(0, 10);

export class Pace {
  constructor(cfg, stateDir, log) {
    this.cfg = cfg; this.log = log;
    this.file = path.join(stateDir, `pages-${kstDay()}.json`);
    this.count = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')).count || 0 : 0;
    this.sinceBreak = 0;
  }
  inHours() {
    const [from, to] = this.cfg.allowedHours || [0, 24];
    const h = kstNow().getUTCHours();
    return h >= from && h < to;
  }
  canContinue() {
    if (this.count >= this.cfg.dailyMaxPages) { this.log(`오늘 화면 수 한도(${this.cfg.dailyMaxPages}) 도달 — 내일 이어서`); return false; }
    if (!this.inHours()) { this.log('허용 시간대가 끝남 — 내일 이어서'); return false; }
    return true;
  }
  // 화면 하나를 열기 전에 부른다
  async beforePage() {
    if (this.count > 0) {
      const p = this.cfg.pace;
      await sleep(rand(p.minSeconds, p.maxSeconds) * 1000);
      this.sinceBreak++;
      if (this.sinceBreak >= p.longBreakEvery) {
        const s = rand(p.longBreakSeconds[0], p.longBreakSeconds[1]);
        this.log(`잠깐 쉼 ${Math.round(s)}초`);
        await sleep(s * 1000);
        this.sinceBreak = 0;
      }
    }
    this.count++;
    fs.writeFileSync(this.file, JSON.stringify({ count: this.count }));
  }
}
