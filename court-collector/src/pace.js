// 최대한 천천히: 하루 1,000화면을 허용 시간대 전체에 고르게 펴고(화면마다 대략 1분 안팎, 무작위),
// 30화면마다 4~10분 쉬고, 1시간 안팎 보면 브라우저를 닫고 30~90분 끊었다가 다시 접속한다(config.json). 하루 화면 수·시간대 제한.
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
  // 오늘 남은 시간에 남은 화면 수를 고르게 펴서 한 화면당 쉬는 시간을 정한다(최대한 천천히).
  //  남은 시간의 workShare(기본 65%)만 화면 사이에 쓰고 나머지는 '끊고 쉬는' 시간으로 남겨 둔다.
  spreadSeconds() {
    const p = this.cfg.pace;
    const [, to] = this.cfg.allowedHours || [0, 24];
    const now = kstNow();
    const end = new Date(now); end.setUTCHours(to, 0, 0, 0);
    const leftSec = Math.max(0, (end - now) / 1000);
    const leftPages = Math.max(1, this.cfg.dailyMaxPages - this.count);
    const even = (leftSec * (p.workShare ?? 0.65)) / leftPages;
    const base = Math.min(p.maxSpreadSeconds ?? 180, Math.max(p.minSeconds, even));
    return base * rand(0.6, 1.4);
  }
  // 한동안 보다가 끊고 쉰다(브라우저를 닫았다가 나중에 다시 접속) — 사람이 자리를 비우는 것처럼
  sessionOver() {
    const s = this.cfg.session;
    if (!s) return false;
    if (!this.sessionStart) { this.sessionStart = Date.now(); this.sessionLen = rand(s.workMinutes[0], s.workMinutes[1]) * 60e3; }
    return Date.now() - this.sessionStart > this.sessionLen;
  }
  async restBetweenSessions() {
    const s = this.cfg.session;
    const m = rand(s.restMinutes[0], s.restMinutes[1]);
    this.log(`끊고 쉼 ${Math.round(m)}분 (브라우저 닫음)`);
    await sleep(m * 60e3);
    this.sessionStart = null; this.sinceBreak = 0;
  }
  // 화면 하나를 열기 전에 부른다
  async beforePage() {
    if (this.count > 0) {
      const p = this.cfg.pace;
      await sleep((p.spread ? this.spreadSeconds() : rand(p.minSeconds, p.maxSeconds)) * 1000);
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
