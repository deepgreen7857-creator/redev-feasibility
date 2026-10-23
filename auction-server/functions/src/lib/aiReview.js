// Claude 검토 — 사이트의 규칙 계산(검토서)을 Claude에게 보내 '사람처럼' 독립적으로 다시 따져 보게 한다.
// 관리자가 버튼을 눌렀을 때만 돈다(물건 1건 = 호출 1번). 결과는 물건에 붙이고, 규칙 수정 제안은 따로 모은다.
const API = 'https://api.anthropic.com/v1/messages';

const SYSTEM = `너는 수도권 법원경매·공매 권리분석과 도시정비사업(재개발·재건축·소규모주택정비) 인허가 실무에 밝은 검토자다.
사용자는 인천 구청 정비사업 인허가 공무원이며, 법인 명의로 경공매 물건을 사서 보유 없이 되파는(단타) 것을 준비하고 있다. 여유 자금이 많지 않다.
아래에 한 물건의 원자료와, 웹사이트가 정해진 규칙으로 자동 계산한 검토 결과가 있다.
너의 일: 규칙 계산을 그대로 믿지 말고, 원자료를 보고 독립적으로 다시 검토한 뒤, 사이트 판단과 어디가 같고 어디가 다른지 밝힌다.
- 숫자는 원자료에 있는 것만 쓴다. 모르는 것은 모른다고 쓰고 무엇을 확인해야 하는지 적는다.
- 권리분석(말소기준, 대항력, 인수 권리, 법정지상권, 지분, 유치권 등), 가치(시세·감정가·공시가격의 관계), 정비사업(단계·분양자격·현금청산), 세금(법인 취득세 중과 등), 출구(누구에게 얼마에 팔 수 있나)를 본다.
- 특수물건이면 가치가 오를 수 있는 시나리오와 그 조건을 실무적으로 따진다.
- 사이트 규칙이 틀렸다고 보면, 다른 물건에도 적용할 수 있는 '규칙 수정 제안'으로 적는다.
반드시 아래 JSON 하나만 출력한다(설명 문장 없이):
{"conclusion":"한두 문장 결론","verdict":"입찰 검토|조건부 검토|보류|제외","bidRange":{"low":숫자 또는 null,"high":숫자 또는 null,"reason":"입찰가 범위 근거"},
"agree":["사이트 판단과 같은 점"],"disagree":[{"step":"시세|오류의심|특수물건|비용|매수상한|회차|판정|세금|매력도|올수리|분양자격|권리","site":"사이트 판단","mine":"내 판단","why":"이유"}],
"risks":["사이트가 놓친 위험"],"upside":["가치가 오를 수 있는 점"],"checks":["입찰 전 직접 확인할 것(서류·현장)"],
"ruleSuggestions":[{"step":"단계","rule":"고칠 규칙(다른 물건에도 적용되게)","why":"이유"}],"confidence":"높음|보통|낮음"}`;

// 검토서에 해당하는 자료를 글로(너무 길지 않게)
function packet(item, a) {
  const d = item.detail || {};
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').map((k) => [k, o[k]]));
  const raw = {
    ...pick(item, ['source', 'court', 'caseNo', 'title', 'usage', 'address', 'sido', 'sgg', 'emd', 'appraisal', 'minBid', 'firstPrice', 'failCount', 'round', 'bidEnd', 'status', 'landArea', 'buildingArea', 'share', 'bulk', 'propertyTypeName']),
    detail: pick(d, ['addressFull', 'landCategory', 'usageStatus', 'location', 'cautions', 'conditions', 'specialConditions', 'superficies', 'survivingRights', 'shareText', 'baseRightDate', 'distributionDeadline', 'appraisalDate', 'appraisalSummary', 'leases', 'rights', 'occupants']),
    land: item.land ? pick(item.land, ['jimok', 'officialPrice', 'roadSide', 'terrain']) : undefined,
    landUse: item.land?.landUse ? pick(item.land.landUse, ['zone', 'redevelopment', 'farmPromotion', 'greenbelt', 'roadConflict']) : undefined,
    housePrice: item.housePrice, ledger: item.ledger ? { useApr: item.ledger.useApr, age: item.ledger.age, unit: item.ledger.unit, title: item.ledger.titles?.[0] } : undefined,
    permits: item.permits ? pick(item.permits, ['years', 'total', 'newBuild', 'nearby']) : undefined,
    neighbors: item.neighbors ? pick(item.neighbors, ['checked', 'landlocked', 'note']) : undefined,
    zone: item.manual?.zone, manual: item.manual ? pick(item.manual, ['asking', 'special', 'creditor', 'redevStage', 'econ']) : undefined,
    bidHistory: item.bidInfo?.history, result: item.result,
  };
  const site = a ? {
    verdict: a.verdict, value: a.value, full: a.full, valueBasis: a.valueBasis, cap: a.cap, entry: a.entry,
    valuation: a.valuation && { anchors: a.valuation.anchors?.map((x) => pick(x, ['label', 'value', 'low', 'high', 'basis', 'used', 'why', 'grade'])), summary: a.valuation.summary, confidence: a.valuation.confidence, auction: a.valuation.auction },
    market: a.market && pick(a.market, ['basis', 'count', 'grade', 'low', 'high']), jeonse: a.jeonse,
    special: a.special && { types: a.special.types?.map((t) => ({ key: t.key, label: t.label, evidence: t.evidence, floorBasis: t.floorBasis })), floor: a.special.floor, floorKnown: a.special.floorKnown, expected: a.special.expected, scenarios: a.special.scenarios?.map((x) => pick(x, ['name', 'value', 'prob', 'months', 'conditions'])) },
    costs: a.costs, money: a.money && pick(a.money, ['price', 'loan', 'own', 'profit', 'roi', 'months', 'fit']), score: a.score, member: a.member,
    renovation: a.renovation, opportunity: a.opportunity, warnings: a.warnings, anomalies: a.anomalies, reasons: a.reasons,
  } : null;
  return `[원자료]\n${JSON.stringify(raw)}\n\n[사이트 자동 검토 결과]\n${JSON.stringify(site)}`;
}

function parseJson(text) {
  const s = String(text || '');
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('검토 결과를 읽지 못했습니다');
  return JSON.parse(s.slice(i, j + 1));
}

async function review({ item, analysis, apiKey, model = 'claude-sonnet-5-5', fetcher = fetch }) {
  if (!apiKey) throw new Error('Claude API 키(ANTHROPIC_API_KEY)가 서버에 없습니다.');
  const res = await fetcher(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content: packet(item, analysis) }] }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Claude API 오류 ${res.status}: ${(data && data.error && data.error.message) || ''}`);
  const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const out = parseJson(text);
  return { ...out, model, at: new Date().toISOString(), usage: data.usage || null };
}

module.exports = { review, packet, parseJson, SYSTEM };
