// data.go.kr 국립중앙도서관 좌석 API를 서버(GitHub Actions)에서 대신 호출해
// data/lib-index.json, data/lib-seats.json으로 스냅샷 저장한다.
// 브라우저에서 apis.data.go.kr을 직접 호출하면 CORS가 막혀서, index.html은
// 이 스냅샷 파일을 같은 오리진에서 읽는다.
const fs = require("fs");
const path = require("path");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return {};
  const out = {};
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

const env = { ...loadEnv(), ...process.env };
const LIB_API_KEY = env.LIB_API_KEY;
if (!LIB_API_KEY) {
  console.error("LIB_API_KEY가 없습니다. 로컬은 .env에 LIB_API_KEY=키값, GitHub Actions는 secrets.LIB_API_KEY를 설정하세요.");
  process.exit(1);
}
const DATA_DIR = path.join(__dirname, "..", "data");

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchIndex() {
  const data = await fetchJson(
    `https://apis.data.go.kr/B551982/plr_v2/info_v2?serviceKey=${encodeURIComponent(LIB_API_KEY)}&pageNo=1&numOfRows=300&resultType=json`
  );
  const items = (data.body && data.body.item) || [];
  if (!items.length) throw new Error("library index came back empty");
  return items;
}

async function fetchSeatsForStdgCd(stdgCd) {
  const data = await fetchJson(
    `https://apis.data.go.kr/B551982/plr_v2/rlt_rdrm_info_v2?serviceKey=${encodeURIComponent(LIB_API_KEY)}&stdgCd=${encodeURIComponent(stdgCd)}&numOfRows=50&resultType=json`
  );
  return (data.body && data.body.item) || [];
}

async function main() {
  const indexItems = await fetchIndex();
  const stdgCds = [...new Set(indexItems.map(i => i.stdgCd))];

  const seatRows = [];
  for (const stdgCd of stdgCds) {
    try {
      const rows = await fetchSeatsForStdgCd(stdgCd);
      seatRows.push(...rows);
    } catch (e) {
      console.error(`seat fetch failed for stdgCd ${stdgCd}:`, e.message);
    }
    // 공공데이터포털 과호출 방지용 짧은 텀
    await new Promise(r => setTimeout(r, 150));
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const indexOut = indexItems.map(i => ({
    pblibId: i.pblibId,
    pblibNm: i.pblibNm,
    stdgCd: i.stdgCd,
    lat: i.lat,
    lot: i.lot,
    pblibRoadNmAddr: i.pblibRoadNmAddr
  }));
  fs.writeFileSync(
    path.join(DATA_DIR, "lib-index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), items: indexOut })
  );

  fs.writeFileSync(
    path.join(DATA_DIR, "lib-seats.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), items: seatRows })
  );

  console.log(`libraries: ${indexOut.length}, seat rows: ${seatRows.length} (from ${stdgCds.length} regions)`);
}

main().catch(e => {
  console.error("fetch-library-data failed:", e);
  process.exit(1);
});
