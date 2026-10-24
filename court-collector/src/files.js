// 법원 첨부(감정평가서·현황조사서·매각물건명세서·사진) 보관과 서버 올리기
//  · 원본은 이 PC 하드에 그대로 둔다: .env 의 ORIGINALS_DIR(예: E:\경매원본), 없으면 state/originals
//    폴더: <ORIGINALS_DIR>/<법원>/<사건번호>_<물건번호>/감정평가서.pdf, 사진01.jpg ...
//  · 서버(사이트)에는 PDF는 그대로(관리자만 열림), 사진은 줄인 것만 올린다.
//  · 못 올린 것은 state/files-pending.json 에 남겨 다음에 다시 보낸다(원본 파일 경로만 기억).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_UPLOAD = 22 * 1024 * 1024; // 서버 요청 한도(32MB) 안에 base64로 들어가는 크기
export const DOC_KINDS = ['감정평가서', '현황조사서', '매각물건명세서'];

export const listingIdOf = (court, caseNo, itemNo) =>
  `court_${String(court).replace(/\s/g, '')}_${String(caseNo).replace(/\s/g, '')}_${String(itemNo || '1').replace(/\D/g, '') || '1'}`;

const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]/g, '');

export class FileStore {
  constructor({ root, stateDir, env, log, dry }) {
    this.dir = env.ORIGINALS_DIR ? path.resolve(env.ORIGINALS_DIR) : path.join(root, 'state', 'originals');
    this.pendingFile = path.join(stateDir, 'files-pending.json');
    this.pending = fs.existsSync(this.pendingFile) ? JSON.parse(fs.readFileSync(this.pendingFile, 'utf8')) : [];
    this.env = env; this.log = log; this.dry = dry;
    this.stats = { saved: 0, uploaded: 0, tooBig: 0, failed: 0, sharedReuse: 0 };
    // 같은 문서(병합·중복사건, 한 사건의 여러 물건번호)는 내용이 같으므로 한 번만 저장한다: 해시 → 이 문서를 쓰는 물건들
    this.indexFile = path.join(stateDir, 'doc-index.json');
    this.index = fs.existsSync(this.indexFile) ? JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) : {};
  }

  saveIndex() { fs.writeFileSync(this.indexFile, JSON.stringify(this.index)); }
  static hashOf(buf) { return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 20); }

  /**
   * PDF 문서 보관(내용 기준 한 번만). 원본: <ORIGINALS_DIR>/_공유문서/<종류>_<해시>.pdf, 물건 폴더에는 어디 있는지만 적는다.
   * meta: { pages: 이 물건 관련 쪽, cases: 문서에 나오는 사건번호들 } → 서버에 함께 보냄
   */
  keepDoc({ court, caseNo, itemNo, kind, buf, upBuf, meta = {} }) {
    const hash = FileStore.hashOf(buf);
    const shared = path.join(this.dir, '_공유문서');
    fs.mkdirSync(shared, { recursive: true });
    const orig = path.join(shared, `${kind}_${hash}.pdf`);
    if (!fs.existsSync(orig)) { fs.writeFileSync(orig, buf); this.stats.saved++; } else this.stats.sharedReuse++;
    let up = orig;
    if (upBuf) { up = path.join(shared, `${kind}_${hash}_사이트용.pdf`); if (!fs.existsSync(up)) fs.writeFileSync(up, upBuf); }
    const listingId = listingIdOf(court, caseNo, itemNo);
    const ent = (this.index[hash] ||= { kind, orig, up, listings: [] });
    if (!ent.listings.includes(listingId)) ent.listings.push(listingId);
    ent.up = up; this.saveIndex();
    const folder = path.join(this.dir, safe(court), `${safe(caseNo)}_${String(itemNo || '1')}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${kind}.json`), JSON.stringify({ hash, 원본: orig, 함께쓰는물건: ent.listings, ...meta }, null, 1));
    this.pending = this.pending.filter((p) => !(p.listingId === listingId && p.kind === kind));
    this.pending.push({ listingId, kind, path: up, hash, meta, contentType: 'application/pdf', at: Date.now() });
    this.savePending();
    return hash;
  }

  /** 같은 사건의 다른 물건번호가 이미 받은 문서를 다시 열지 않고 그대로 이어 쓴다(화면 수 아낌). */
  reuseDoc({ court, caseNo, itemNo, kind, hash, meta = {} }) {
    const ent = this.index[hash];
    if (!ent || !fs.existsSync(ent.up)) return false;
    const listingId = listingIdOf(court, caseNo, itemNo);
    if (!ent.listings.includes(listingId)) { ent.listings.push(listingId); this.saveIndex(); }
    const folder = path.join(this.dir, safe(court), `${safe(caseNo)}_${String(itemNo || '1')}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `${kind}.json`), JSON.stringify({ hash, 원본: ent.orig, 함께쓰는물건: ent.listings, ...meta }, null, 1));
    this.pending = this.pending.filter((p) => !(p.listingId === listingId && p.kind === kind));
    this.pending.push({ listingId, kind, path: ent.up, hash, meta, contentType: 'application/pdf', at: Date.now() });
    this.savePending(); this.stats.sharedReuse++;
    return true;
  }

  savePending() { fs.writeFileSync(this.pendingFile, JSON.stringify(this.pending)); }

  /** 원본을 하드에 저장하고, 서버에 올릴 목록에 넣는다. upBuf 를 주면 그것을 올린다(사진은 줄인 것). */
  keep({ court, caseNo, itemNo, kind, buf, ext, upBuf, upExt }) {
    const folder = path.join(this.dir, safe(court), `${safe(caseNo)}_${String(itemNo || '1')}`);
    fs.mkdirSync(folder, { recursive: true });
    const orig = path.join(folder, `${kind}.${ext}`);
    fs.writeFileSync(orig, buf);
    this.stats.saved++;
    let up = orig;
    if (upBuf) { up = path.join(folder, `${kind}_사이트용.${upExt || ext}`); fs.writeFileSync(up, upBuf); }
    const listingId = listingIdOf(court, caseNo, itemNo);
    this.pending = this.pending.filter((p) => !(p.listingId === listingId && p.kind === kind));
    this.pending.push({ listingId, kind, path: up, contentType: /jpe?g$/i.test(upExt || ext) ? 'image/jpeg' : 'application/pdf', at: Date.now() });
    this.savePending();
  }

  /** 이미 하드에 있는 파일(같은 사건 다른 물건번호가 받은 사진 등)을 이 물건에도 올린다. */
  keepFile({ court, caseNo, itemNo, kind, path: file, contentType }) {
    const listingId = listingIdOf(court, caseNo, itemNo);
    this.pending = this.pending.filter((p) => !(p.listingId === listingId && p.kind === kind));
    this.pending.push({ listingId, kind, path: file, contentType, at: Date.now() });
    this.savePending();
  }

  /** 글자 화면 문서(현황조사서)의 원문 글자 — 파일은 이미 하드에 저장됨(file). 서버에는 관리자 전용으로 보낸다. */
  keepText({ court, caseNo, itemNo, kind, file }) {
    const listingId = listingIdOf(court, caseNo, itemNo);
    const k = `${kind}_글자`;
    this.pending = this.pending.filter((p) => !(p.listingId === listingId && p.kind === k));
    this.pending.push({ listingId, kind: k, path: file, contentType: 'text/plain', at: Date.now() });
    this.savePending();
  }

  /** 서버에 물건이 올라간 뒤 부른다. ids 를 주면 그 물건 것만, 없으면 밀린 것 전부. 토큰 오류면 throw. */
  async upload(ids) {
    if (this.dry || !this.pending.length) return;
    const want = ids ? new Set(ids) : null;
    const todo = this.pending.filter((p) => !want || want.has(p.listingId));
    let fails = 0;
    for (const p of todo) {
      if (!fs.existsSync(p.path)) { this.drop(p); continue; }
      // 같은 문서가 서버에 이미 있으면 파일은 보내지 않고 이 물건에 연결만 한다
      if (p.hash) {
        try {
          const r = await this.post({ action: 'fileRef', listingId: p.listingId, kind: p.kind, hash: p.hash, meta: p.meta });
          if (!r.need) { this.drop(p); fails = 0; continue; }
        } catch (e) {
          if (e.status === 401) throw e;
          this.stats.failed++; fails++; this.log(`첨부 연결 실패 ${p.listingId} ${p.kind}: ${e.message} — 다음에 다시`);
          if (fails >= 3) return; continue;
        }
      }
      const buf = fs.readFileSync(p.path);
      if (buf.length > MAX_UPLOAD) {
        // 너무 큰 문서는 이 PC 하드에만 두고, 사이트에는 '원본 보관 중(용량)'만 알린다
        await this.post({ action: 'fileMeta', listingId: p.listingId, kind: p.kind, size: buf.length, local: true, hash: p.hash, meta: p.meta }).catch(() => {});
        this.stats.tooBig++; this.log(`첨부 큼(하드에만 보관) ${p.listingId} ${p.kind} ${(buf.length / 1048576).toFixed(1)}MB`);
        this.drop(p); continue;
      }
      try {
        if (p.contentType === 'text/plain') await this.post({ action: 'fileText', listingId: p.listingId, kind: p.kind.replace(/_글자$/, ''), text: buf.toString('utf8').slice(0, 200000) });
        else await this.post({ action: 'file', listingId: p.listingId, kind: p.kind, contentType: p.contentType, hash: p.hash, meta: p.meta, data: buf.toString('base64') });
        this.stats.uploaded++; this.drop(p); fails = 0;
      } catch (e) {
        if (e.status === 401) throw e;
        this.stats.failed++; fails++;
        this.log(`첨부 올리기 실패 ${p.listingId} ${p.kind}: ${e.message} — 다음에 다시`);
        if (fails >= 3) return; // 서버가 안 되는 중 — 남은 것은 다음에
      }
    }
  }

  drop(p) { this.pending = this.pending.filter((x) => x !== p); this.savePending(); }

  async post(body) {
    const res = await fetch(this.env.INGEST_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.INGEST_TOKEN}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(180e3),
    });
    const text = await res.text();
    if (!res.ok) { const e = new Error(`HTTP ${res.status} ${text.slice(0, 150)}`); e.status = res.status; if (res.status === 401) e.retry = false; throw e; }
    const j = JSON.parse(text || '{}');
    if (j.ok === false) throw new Error(j.error || '서버 거절');
    return j;
  }
}
