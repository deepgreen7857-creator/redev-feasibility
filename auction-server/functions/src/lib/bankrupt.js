// 대법원 「회생·파산 자산매각 안내」 공고 게시판 수집(전국).
// 공고 본문은 대부분 첨부 PDF라, 여기서는 목록·상세의 기본 정보와 첨부 이름을 모으고
// 제목·첨부 이름으로 부동산 포함 여부를 1차 분류한다(최종 확인은 원문).
const cheerio = require('cheerio');

const BASE = 'https://www.scourt.go.kr';
const LIST = `${BASE}/portal/notice/realestate/RealNoticeList.work`;
const VIEW = `${BASE}/portal/notice/realestate/RealNoticeView.work`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RE_REAL = /(부동산|토지|건물|아파트|임야|대지|주택|상가|공장|오피스텔|빌라|다세대|연립|전답|창고|근린|지분|호실|필지)/;
const RE_NONREAL = /(채권|주식|출자|차량|자동차|상표|특허|회원권|(?<!부)동산|재고|기계|비품|영업권|매출채권|예금|보증금반환)/;

const COURT_SIDO = [
  [/서울/, '서울특별시'], [/인천|부천/, '인천광역시'], [/수원|의정부|성남|여주|평택|안산|안양|고양|남양주/, '경기도'],
  [/춘천|강릉|원주|속초|영월/, '강원특별자치도'], [/대전|천안|홍성|공주|논산|서산/, '대전·충남'], [/청주|충주|제천|영동/, '충청북도'],
  [/대구|안동|경주|포항|김천|상주|의성|영덕/, '대구·경북'], [/부산|울산/, '부산·울산'], [/창원|마산|진주|통영|밀양|거창/, '경상남도'],
  [/광주|목포|장흥|순천|해남/, '광주·전남'], [/전주|군산|정읍|남원/, '전북특별자치도'], [/제주/, '제주특별자치도'],
];

function classify(title, attachments = []) {
  const textAll = [title, ...attachments.map((a) => a.name)].join(' ');
  const real = RE_REAL.test(textAll);
  const nonReal = RE_NONREAL.test(textAll);
  return { realEstate: real, kind: real ? (nonReal ? '부동산+기타' : '부동산') : nonReal ? '채권·동산 등' : '확인 필요' };
}

function sidoOfCourt(court) {
  for (const [re, sido] of COURT_SIDO) if (re.test(court || '')) return sido;
  return null;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function parseList(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('table tbody tr').each((_, tr) => {
    const tds = $(tr).find('td');
    const link = $(tr).find('a[href*="seq_id="]').first();
    const href = link.attr('href') || '';
    const m = href.match(/seq_id=(\d+)/);
    if (!m) return;
    const cells = tds.map((__, td) => clean($(td).text())).get();
    rows.push({
      seq: Number(m[1]),
      no: cells[0] || null,
      court: cells[1] || null,
      seller: cells[2] || null,
      title: clean(link.text()) || cells[3] || null,
      views: Number(String(cells[4] || '').replace(/\D/g, '')) || null,
    });
  });
  const last = $('a[href*="pageIndex="]').map((_, a) => Number((($(a).attr('href') || '').match(/pageIndex=(\d+)/) || [])[1] || 0)).get();
  return { rows, lastPage: last.length ? Math.max(...last) : 1 };
}

function parseView(html) {
  const $ = cheerio.load(html);
  const fields = {};
  $('th').each((_, th) => {
    const key = clean($(th).text());
    const td = $(th).next('td');
    if (key && td.length) fields[key] = clean(td.text());
  });
  const attachments = [];
  $('a').each((_, a) => {
    const href = $(a).attr('href') || '';
    const onclick = $(a).attr('onclick') || '';
    const name = clean($(a).text());
    if (/download|filedown|fileDown|atchFile|FileDown/i.test(href + onclick) || /\.(pdf|hwp|hwpx|docx?|xlsx?|zip)$/i.test(name)) {
      if (name) attachments.push({ name, href: href.startsWith('/') ? BASE + href : href || null, onclick: onclick || null });
    }
  });
  return {
    seller: fields['매각기관'] || null,
    court: fields['관할법원'] || null,
    title: fields['제목'] || null,
    postedAt: (fields['작성일'] || '').replace(/\./g, '-') || null,
    expiresAt: (fields['공고만료일'] || '').replace(/\./g, '-') || null,
    phone: fields['전화번호'] || null,
    attachments,
  };
}

// 대법원 사이트는 EUC-KR(한글 완성형)로 내려오는 쪽이 있어 문자셋을 보고 풀어 읽는다
async function decodeHtml(res) {
  if (!res.arrayBuffer) return res.text();
  const buf = Buffer.from(await res.arrayBuffer());
  const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  let charset = (type.match(/charset=([\w-]+)/i) || [])[1];
  if (!charset) charset = (buf.subarray(0, 2000).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1];
  charset = (charset || 'utf-8').toLowerCase();
  if (/euc-?kr|ks_c_5601|cp949|ms949/.test(charset)) return new TextDecoder('euc-kr').decode(buf);
  return buf.toString('utf8');
}

async function get(url, fetcher) {
  const res = await fetcher(url, { headers: { 'User-Agent': 'Mozilla/5.0 (jbslab auction collector)' }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  return decodeHtml(res);
}

// knownMaxSeq: 지난번까지 받은 가장 큰 글번호. 그보다 작은 글이 나오면 멈춘다.
async function collect({ fetcher = fetch, knownMaxSeq = 0, maxPages = 5, save, log = console.log, delayMs = 700 }) {
  const stats = { pages: 0, found: 0, saved: 0, maxSeq: knownMaxSeq, errors: [] };
  let lastPage = maxPages;
  for (let page = 1; page <= Math.min(maxPages, lastPage); page++) {
    let parsed;
    try { parsed = parseList(await get(`${LIST}?pageIndex=${page}`, fetcher)); } catch (e) { stats.errors.push(`목록 ${page}쪽: ${e.message}`); break; }
    stats.pages++;
    lastPage = parsed.lastPage || lastPage;
    const fresh = parsed.rows.filter((r) => r.seq > knownMaxSeq);
    for (const row of fresh) {
      await sleep(delayMs);
      let view = {};
      try { view = parseView(await get(`${VIEW}?pageIndex=1&bub_cd=&searchWord=&searchOption=&seq_id=${row.seq}`, fetcher)); } catch (e) { stats.errors.push(`상세 ${row.seq}: ${e.message}`); }
      const item = { ...row, ...Object.fromEntries(Object.entries(view).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length))) };
      item.attachments = view.attachments || [];
      Object.assign(item, classify(item.title, item.attachments));
      item.sido = sidoOfCourt(item.court);
      item.url = `${VIEW}?seq_id=${row.seq}`;
      item.id = `scourt_${row.seq}`;
      await save(item);
      stats.saved++;
      stats.maxSeq = Math.max(stats.maxSeq, row.seq);
    }
    stats.found += fresh.length;
    if (fresh.length < parsed.rows.length) break; // 이미 받은 글에 닿음
    await sleep(delayMs);
  }
  log(`파산 공고: 새 글 ${stats.saved}건`);
  return stats;
}

module.exports = { parseList, parseView, classify, sidoOfCourt, collect, decodeHtml, LIST, VIEW };
