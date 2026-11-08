/* Bin Raider - deal maths. Pure functions, no DOM, so they can be unit tested in Node. */
(function (root) {
  // How a copy in each grade is typically priced against a VG+ copy of the same pressing.
  var GRADES = [
    { id: "M", label: "Mint (M)", mult: 1.4 },
    { id: "NM", label: "Near Mint (NM)", mult: 1.25 },
    { id: "VG+", label: "Very Good Plus (VG+)", mult: 1.0 },
    { id: "VG", label: "Very Good (VG)", mult: 0.65 },
    { id: "G+", label: "Good Plus (G+)", mult: 0.4 },
    { id: "G", label: "Good (G) or worse", mult: 0.25 }
  ];

  function gradeMult(id) {
    for (var i = 0; i < GRADES.length; i++) if (GRADES[i].id === id) return GRADES[i].mult;
    return 1;
  }

  function num(v) {
    var n = typeof v === "number" ? v : parseFloat(String(v == null ? "" : v).replace(/[£,\s]/g, ""));
    return isFinite(n) ? n : NaN;
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  // Score 0-100. A copy at the reference price scores 50; 40% under scores 100; 40% over scores 0.
  function score(total, reference) {
    if (!(total > 0) || !(reference > 0)) return null;
    var r = total / reference;
    var s = Math.round(50 + (1 - r) * 125);
    return Math.max(0, Math.min(100, s));
  }

  function verdict(s) {
    if (s == null) return { key: "none", label: "No reference price" };
    if (s >= 80) return { key: "steal", label: "Steal" };
    if (s >= 62) return { key: "good", label: "Good deal" };
    if (s >= 45) return { key: "fair", label: "Fair price" };
    if (s >= 25) return { key: "steep", label: "Bit steep" };
    return { key: "pricey", label: "Overpriced" };
  }

  // price + postage against a reference (VG+ unless refGrade says otherwise), adjusted to the copy's grade.
  function evaluate(o) {
    var price = num(o.price), post = num(o.postage);
    if (!isFinite(post) || post < 0) post = 0;
    var ref = num(o.reference);
    if (!isFinite(price) || price < 0) return { ok: false, error: "Enter the price." };
    var total = round2(price + post);
    var adjRef = isFinite(ref) && ref > 0 ? round2(ref * gradeMult(o.grade || "VG+") / gradeMult(o.refGrade || "VG+")) : null;
    var s = adjRef ? score(total, adjRef) : null;
    var v = verdict(s);
    var diff = adjRef ? round2(total - adjRef) : null;
    var pct = adjRef ? Math.round((total / adjRef - 1) * 100) : null;
    // the most you should pay, including postage, to still call it a good deal (score 62)
    var walkAway = adjRef ? round2(adjRef * (1 - (62 - 50) / 125)) : null;
    return { ok: true, total: total, postage: round2(post), adjustedReference: adjRef, score: s, verdict: v, diff: diff, pct: pct, goodDealBelow: walkAway };
  }

  function gbp(n) {
    if (n == null || !isFinite(n)) return "–";
    return "£" + n.toFixed(2);
  }

  var api = { GRADES: GRADES, gradeMult: gradeMult, score: score, verdict: verdict, evaluate: evaluate, gbp: gbp, num: num };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.BRDeal = api;
})(this);
