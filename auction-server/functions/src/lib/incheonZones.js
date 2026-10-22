// 인천광역시 추정분담금 정보시스템 자료실 — 매달 올라오는 「도시정비사업 추진현황(○월말 기준)」 엑셀 자동 수집
//  첨부 1: 도시정비사업 추진현황.xlsx, 첨부 2: 소규모주택정비사업 추진현황.xlsx
const cheerio = require('cheerio');
const XLSX = require('xlsx');

const BASE = 'https://renewal.incheon.go.kr';
const BOARD = `${BASE}/ires/program/0000-0020-0039/program/board`;
const BBS_ID = 'BBSMSTR_000000000015';
const LIST = `${BOARD}/board.do?bbs_id=${BBS_ID}`;
const VIEW = (ntt) => `${BOARD}/board_inscr.do?bbs_id=${BBS_ID}&ntt_id=${ntt}&page=1&listSize=10&searchCondition=&searchKeyword=`;
const UA = { 'User-Agent': 'Mozilla/5.0 (jbslab redevelopment collector)' };

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const abs = (href) => (!href ? null : href.startsWith('http') ? href : href.startsWith('/') ? BASE + href : `${BOARD}/${href}`);

function parseList(html) {
  const $ = cheerio.load(html);
  const posts = [];
  $('a').each((_, a) => {
    const href = $(a).attr('href') || '';
    const onclick = $(a).attr('onclick') || '';
    const m = (href + onclick).match(/ntt_id=(\d+)|fn_?(?:view|detail|inscr)\w*\(\s*'?(\d+)'?/i);
    const title = clean($(a).text());
    if (m && /추진현황/.test(title)) posts.push({ ntt: Number(m[1] || m[2]), title });
  });
  return posts.sort((x, y) => y.ntt - x.ntt);
}

// 첨부파일 링크 찾기: 이름이 .xlsx/.xls로 끝나는 링크(또는 다운로드 함수 호출)
function parseAttachments(html) {
  const $ = cheerio.load(html);
  const files = [];
  $('a').each((_, a) => {
    const name = clean($(a).text());
    const href = $(a).attr('href') || '';
    const onclick = $(a).attr('onclick') || '';
    if (!/\.(xlsx|xls)$/i.test(name)) return;
    let url = href && !/^javascript/i.test(href) && href !== '#' ? abs(href) : null;
    if (!url) {
      // fn_egov_downFile('FILE_000000000012345','0') 같은 전자정부 표준 다운로드 형식
      const m = (href + onclick).match(/['"](FILE_\w+)['"]\s*,\s*['"]?(\d+)['"]?/);
      if (m) url = `${BASE}/cmm/fms/FileDown.do?atchFileId=${m[1]}&fileSn=${m[2]}`;
    }
    files.push({ name, url, onclick: onclick || null });
  });
  return files;
}

function rowsOfWorkbook(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  return wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }));
}

async function get(url, fetcher, binary = false) {
  const res = await fetcher(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return binary ? Buffer.from(await res.arrayBuffer()) : res.text();
}

// knownNtt: 지난번에 받은 글번호. 새 글이 없으면 아무것도 안 한다.
async function collect({ fetcher = fetch, knownNtt = 0, save, log = console.log }) {
  const { parseZones, kindOfFile, basisOf } = await import('./redevZones.mjs');
  const posts = parseList(await get(LIST, fetcher));
  const latest = posts[0];
  if (!latest) return { skipped: '추진현황 글을 찾지 못함(게시판 모양이 바뀌었을 수 있음)' };
  if (latest.ntt <= knownNtt) return { skipped: '새 글 없음', ntt: knownNtt };
  const files = parseAttachments(await get(VIEW(latest.ntt), fetcher));
  if (!files.length) return { error: '첨부 엑셀 링크를 찾지 못함', ntt: latest.ntt, title: latest.title };
  const basis = basisOf(latest.title);
  const zones = [];
  const report = [];
  for (const f of files) {
    if (!f.url) { report.push({ name: f.name, error: '다운로드 주소를 알 수 없음', onclick: f.onclick }); continue; }
    try {
      const sheets = rowsOfWorkbook(await get(f.url, fetcher, true));
      let best = { zones: [] };
      for (const rows of sheets) { const r = parseZones(rows, { sido: '인천광역시', quarter: basis, kind: kindOfFile(f.name) }); if (r.zones.length > best.zones.length) best = r; }
      zones.push(...best.zones);
      report.push({ name: f.name, zones: best.zones.length });
    } catch (e) { report.push({ name: f.name, error: e.message }); }
  }
  if (!zones.length) return { error: '엑셀에서 구역을 읽지 못함', ntt: latest.ntt, report };
  await save({ sido: '인천광역시', zones, quarter: basis, fileName: files.map((f) => f.name).join(', '), source: 'auto', ntt: latest.ntt, title: latest.title });
  log(`인천 정비사업 현황 ${basis}: ${zones.length}개 구역`);
  return { ntt: latest.ntt, title: latest.title, zones: zones.length, report };
}

module.exports = { collect, parseList, parseAttachments, LIST, VIEW };
