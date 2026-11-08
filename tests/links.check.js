const Sites = require("../www/js/sites.js");
const { execFileSync } = require("child_process");
const q = "Portishead Dummy";
const L = Sites.links({ q, uk: true, addVinyl: true });
const UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const rows = [];
for (const l of L) {
  let status = "", final = "", body = "";
  try {
    const r = execFileSync("curl", ["-sL", "--max-time", "20", "-A", UA, "-H", "Accept-Language: en-GB", "-o", "/tmp/body.html", "-w", "%{http_code} %{url_effective}", l.url], { encoding: "utf8" });
    [status, final] = r.split(" ");
    body = require("fs").readFileSync("/tmp/body.html", "utf8");
  } catch (e) { status = "ERR"; }
  const fh = final ? new URL(final).hostname : "";
  const qInUrl = final && decodeURIComponent(final).replace(/\+/g, " ").toLowerCase().includes("portishead");
  const qInBody = /portishead/i.test(body);
  rows.push({ key: l.key, name: l.name, status, finalHost: fh, sameSite: fh.replace(/^www\./, "").split(".").slice(-3).join(".").includes(l.host.replace(/^www\./, "").split(".").slice(-2)[0]), qInUrl, qInBody, len: body.length, final: final.slice(0, 140) });
}
console.log(JSON.stringify(rows, null, 1));
