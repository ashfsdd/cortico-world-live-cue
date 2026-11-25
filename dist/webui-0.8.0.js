function fold(parent, title) {
  const d = document.createElement("details");
  d.style.cssText = "margin:8px 0 2px;border:1px solid rgba(128,128,128,.22);border-radius:10px;padding:0 10px 6px;";
  const sum = document.createElement("summary");
  sum.textContent = title;
  sum.style.cssText = "cursor:pointer;padding:9px 0;font-weight:600;opacity:.85;";
  const box = document.createElement("div");
  box.style.marginTop = "4px";
  d.append(sum, box);
  parent.append(d);
  return box;
}
function grid(cols) {
  const el = document.createElement("div");
  el.style.cssText = `display:grid;grid-template-columns:${cols};gap:14px;align-items:start;`;
  return el;
}
function pair() {
  const el = document.createElement("div");
  el.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end;";
  return el;
}
function mountSettings(ctx) {
  const ui = ctx.ui;
  const sheet = ui.sheet({
    title: "\u76F4\u64AD\u5F39\u5E55\u6865 \xB7 \u8BBE\u7F6E",
    desc: "\u5DE6\u5217\u7BA1\u300C\u8C01\u7ED9\u94B1\u3001\u600E\u4E48\u56DE\u300D\uFF0C\u4E2D\u95F4\u7BA1\u300C\u4EC0\u4E48\u65F6\u5019\u5F00\u53E3\u300D\uFF0C\u53F3\u5217\u7BA1\u300C\u8BDD\u600E\u4E48\u9001\u51FA\u53BB\u300D\uFF0C\u6700\u4E0B\u9762\u662F\u8FDE\u63A5\u53C2\u6570\u3002\u6539\u5B8C\u81EA\u52A8\u4FDD\u5B58\u3002"
  });
  ctx.root.append(sheet.el);
  const msg = ui.msgline();
  const colsTop = grid("1fr");
  colsTop.style.marginTop = "10px";
  sheet.body.append(msg, colsTop);
  let cfg = {};
  const pending = {};
  const binders = [];
  let timer = null;
  const set = (key, value) => {
    cfg[key] = value;
    pending[key] = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 450);
  };
  async function flush() {
    timer = null;
    const patch = { ...pending };
    const keys = Object.keys(patch);
    if (!keys.length) return;
    for (const k of keys) delete pending[k];
    try {
      await ctx.invoke("save", [patch]);
      msg.info(`\u5DF2\u4FDD\u5B58 ${keys.length} \u9879 \xB7 \u7ACB\u5373\u751F\u6548\uFF08\u6539\u8FDE\u63A5\u5730\u5740\u9700\u91CD\u542F World\uFF09`);
    } catch (e) {
      msg.error(`\u4FDD\u5B58\u5931\u8D25\uFF1A${String(e).slice(0, 90)}`);
    }
  }
  const cols = grid("repeat(auto-fit, minmax(290px, 1fr))");
  sheet.body.append(cols);
  function numField(sec, label, key, hint) {
    const input = ui.input({
      type: "number",
      value: String(cfg[key] ?? ""),
      onInput: (v) => set(key, v === "" ? 0 : Number(v))
    });
    const field = ui.field(label, input);
    if (hint) field.title = hint;
    sec.append(field);
    binders.push({ key, apply: () => {
      input.value = cfg[key] == null ? "" : String(cfg[key]);
    } });
    return input;
  }
  function textField(sec, label, key, hint) {
    const input = ui.input({
      value: String(cfg[key] ?? ""),
      onInput: (v) => set(key, v)
    });
    const field = ui.field(label, input);
    if (hint) field.title = hint;
    sec.append(field);
    binders.push({ key, apply: () => {
      input.value = cfg[key] == null ? "" : String(cfg[key]);
    } });
  }
  function areaField(sec, label, key, rows = 3, placeholder = "") {
    const area = ui.textarea({
      rows,
      value: String(cfg[key] ?? ""),
      placeholder,
      onInput: (v) => set(key, v)
    });
    sec.append(ui.field(label, area));
    binders.push({ key, apply: () => {
      area.value = cfg[key] == null ? "" : String(cfg[key]);
    } });
  }
  function boolField(sec, label, key, hint) {
    const box = ui.checkbox(label, {
      checked: Boolean(cfg[key]),
      title: hint,
      onChange: (v) => set(key, v)
    });
    sec.append(box.el);
    binders.push({ key, apply: () => box.setChecked(Boolean(cfg[key])) });
  }
  const pickField = (sec, label, key, options, hint) => {
    const sel = ui.select({
      value: String(cfg[key] ?? ""),
      options,
      onInput: (v) => set(key, v)
    });
    const field = ui.field(label, sel);
    if (hint) field.title = hint;
    sec.append(field);
    binders.push({ key, apply: () => {
      sel.value = String(cfg[key] ?? "");
    } });
  };
  const c1 = ui.section("\u{1F4B0} \u5FC5\u56DE\u4E0E\u6253\u8D4F", "\u8C01\u82B1\u4E86\u94B1\u3001\u82B1\u4E86\u591A\u5C11\uFF0C\u8FD9\u91CC\u5B9A\u95E8\u69DB\u3002");
  cols.append(c1);
  numField(c1, "\u793C\u7269\u95E8\u69DB\uFF08\u5143\uFF09", "minGiftYuan", "\u8FBE\u5230\u8FD9\u4E2A\u91D1\u989D 100% \u5FC5\u56DE");
  boolField(c1, "\u6E38\u620F\u9053\u5177\u793C\u7269\u5FC5\u56DE\uFF08\u4E0D\u770B\u91D1\u989D\uFF09", "gameGiftAlwaysReply");
  numField(c1, "\u793C\u7269\u5408\u5E76\u7A97\u53E3\uFF08\u79D2\uFF0C0 = \u4E0D\u5408\u5E76\uFF09", "giftMergeSec", "\u7A97\u53E3\u5185\u7684\u591A\u4E2A\u793C\u7269\u5408\u6210\u4E00\u6B21\u56DE\u8BDD\uFF0C\u7701 token");
  numField(c1, "\u5927\u989D\u793C\u7269\u95E8\u69DB\uFF08\u5143\uFF0C0 = \u4E0D\u5355\u5217\uFF09", "bigGiftYuan", "\u8FBE\u5230\u8FD9\u4E2A\u6570\u7684\u793C\u7269\u5355\u72EC\u53D1\u4E00\u6761\uFF0C\u4E0D\u8DDF\u5C0F\u989D\u5408\u5E76");
  boolField(c1, "\u5C0F\u989D\u793C\u7269\u4E5F\u63A5\u4E00\u53E5\uFF08\u4E0D\u9759\u9ED8\u4E22\uFF09", "cheapGiftAsChance");
  boolField(c1, "\u9192\u76EE\u7559\u8A00 SC \u5FC5\u56DE", "replyOnSuperChat");
  numField(c1, "SC \u8BFB\u5B8C\u518D\u56DE\uFF08\u79D2\uFF09", "scDelaySec", "0 = \u7ACB\u5373\u56DE\uFF1B8 = \u5148\u770B\u5B8C");
  boolField(c1, "\u4E0A\u8230\u5FC5\u56DE", "replyOnGuard");
  boolField(c1, "\u8230\u957F / \u63D0\u7763 / \u603B\u7763 \u8FDB\u573A\u5FC5\u6B22\u8FCE", "guardWelcome");
  numField(c1, "\u6BCF\u4EBA\u6BCF\u5929\u6700\u591A\u6B22\u8FCE\u51E0\u6B21", "guardWelcomePerDay", "1 = \u6BCF\u4EBA\u6BCF\u5929\u4E00\u6B21\uFF1B0 = \u4E0D\u9650");
  textField(c1, "\u6B22\u8FCE\u8BCD\u98CE\u683C\u63D0\u793A\uFF08\u53EF\u7559\u7A7A\uFF09", "guardWelcomeStyles", "\u7559\u7A7A = \u6BCF\u6B21\u770B\u73B0\u573A\u73B0\u7F16");
  const c2 = ui.section("\u{1F3AF} \u4EC0\u4E48\u65F6\u5019\u5F00\u53E3", "\u6D3B\u8DC3\u5EA6\u548C\u8FC7\u6EE4\u3002\u5C4F\u853D\u8BCD\u53EA\u6321\u300C\u4E3B\u52A8\u63A5\u8BDD\u300D\uFF0C\u70B9\u540D/\u793C\u7269/SC \u7167\u56DE\u3002");
  cols.append(c2);
  const burstInput = ui.input({ type: "number", value: String(cfg["guardBurstSec"] ?? 20), onInput: (v) => set("guardBurstSec", v === "" ? 0 : Number(v)) });
  const sameUserInput = ui.input({ type: "number", value: String(cfg["sameUserGapSec"] ?? 15), onInput: (v) => set("sameUserGapSec", v === "" ? 0 : Number(v)) });
  const activityRow = pair();
  const gapInput = ui.input({
    type: "number",
    value: String(cfg.chanceGapSec ?? 50),
    onInput: (v) => set("chanceGapSec", v === "" ? 0 : Number(v))
  });
  const capInput = ui.input({
    type: "number",
    value: String(cfg.maxPerHour ?? 80),
    onInput: (v) => set("maxPerHour", v === "" ? 0 : Number(v))
  });
  const actSel = ui.select({
    value: "normal",
    options: [
      { value: "quiet", label: "\u5B89\u9759\uFF08120 \u79D2\u4E00\u6761 / 30 \u6761\xB7\u65F6\uFF09" },
      { value: "normal", label: "\u6B63\u5E38\uFF0850 \u79D2\u4E00\u6761 / 80 \u6761\xB7\u65F6\uFF09" },
      { value: "hot", label: "\u70ED\u95F9\uFF0825 \u79D2\u4E00\u6761 / 150 \u6761\xB7\u65F6\uFF09" }
    ],
    onInput: (v) => {
      const map = {
        quiet: { chanceGapSec: 120, maxPerHour: 30 },
        normal: { chanceGapSec: 50, maxPerHour: 80 },
        hot: { chanceGapSec: 25, maxPerHour: 150 }
      };
      const v2 = map[v] || map.normal;
      set("chanceGapSec", v2.chanceGapSec);
      set("maxPerHour", v2.maxPerHour);
      gapInput.value = String(v2.chanceGapSec);
      capInput.value = String(v2.maxPerHour);
    }
  });
  activityRow.append(ui.field("\u6D3B\u8DC3\u5EA6\uFF08\u4E00\u952E\u5207\u6362\uFF09", actSel));
  const numRow = pair();
  numRow.append(ui.field("\u673A\u4F1A\u578B\u6700\u77ED\u95F4\u9694\uFF08\u79D2\uFF09", gapInput), ui.field("\u6BCF\u5C0F\u65F6\u4E0A\u9650\uFF08\u6761\uFF09", capInput));
  c2.append(activityRow, numRow);
  const gate = numField(
    c2,
    "\u89C2\u4F17\u8363\u8A89\u7B49\u7EA7\u95E8\u69DB\uFF080 = \u4E0D\u9650\u5236\uFF09",
    "minUserLevel",
    "\u8363\u8A89\u7B49\u7EA7 = \u76F4\u64AD\u95F4\u89C2\u4F17\u7B49\u7EA7\uFF08\u5F39\u5E55\u540D\u5B57\u65C1\u7684\u7070\u8272\u6570\u5B57\uFF09\uFF0C\u9001\u793C\u6DA8\u5F97\u5FEB\u3001\u6BCF\u65E5\u7B7E\u5230\u4E5F\u80FD\u6DA8\u30020 = \u4E0D\u9650\u5236\uFF1B1 = 0 \u7EA7\u7EAF\u65B0\u4EBA\u5C0F\u53F7\u7684\u5F39\u5E55\u4E0D\u56DE\u5E94\uFF08\u7701 token\uFF09\u3002\u793C\u7269 / SC / \u4E0A\u8230 / \u8230\u957F\u623F\u7BA1\u4E0D\u53D7\u6B64\u95E8\u69DB\u3002"
  );
  gate.style.borderColor = "var(--acc, #7c8cff)";
  gate.style.borderWidth = "1px";
  const burstRow = pair();
  burstRow.append(ui.field("\u623F\u7BA1/\u8230\u957F\u8FDE\u53D1\u95F4\u9694\uFF08\u79D2\uFF09", burstInput), ui.field("\u540C\u4E00\u4EBA\u4E24\u6761\u95F4\u9694\uFF08\u79D2\uFF09", sameUserInput));
  c2.append(burstRow);
  boolField(c2, "\u6709\u4EBA\u53EB\u5979\u5C31\u56DE\uFF08\u540D\u5B57 / @\uFF09", "replyOnAt");
  textField(c2, "\u8BA4\u8FD9\u4E9B\u8BCD\u7B97\u53EB\u5979\uFF08\u9017\u53F7\u5206\u9694\uFF09", "atKeywords");
  boolField(c2, "\u95EE\u53E5\u4E5F\u63A5", "replyOnQuestion");
  boolField(c2, "\u8FC7\u6EE4\u566A\u58F0\uFF08666 / \u7EAF\u8868\u60C5 / \u5237\u5C4F\uFF09", "blockNoise");
  const advD = fold(c2, "\u5C4F\u853D\u8BCD\u4E0E\u540D\u5355\uFF08\u8FDB\u9636\uFF09");
  boolField(advD, "\u8FC7\u6EE4\u8FB1\u9A82\u4E0E\u8D76\u4EBA", "blockHostile");
  boolField(advD, "\u8BF4\u7ED9\u522B\u4EBA\u7684\u4E0D\u63D2\u8BDD", "blockPeerChat");
  areaField(advD, "\u5C4F\u853D\u7528\u6237\uFF08\u9017\u53F7\u5206\u9694\uFF0C\u6A21\u7CCA\u5339\u914D\uFF09", "blockUsers", 2, "\u7167\u6284\u54A9\u64AD\u300C\u5C4F\u853D\u7528\u6237\u540D\u5217\u8868\u300D");
  areaField(advD, "\u5C4F\u853D\u8BCD\uFF08\u9017\u53F7\u5206\u9694\uFF09", "blockWords", 3, "\u7167\u6284\u54A9\u64AD\u300C\u5C4F\u853D\u654F\u611F\u8BCD\u6C47\u300D");
  areaField(advD, "\u989D\u5916\u4E0D\u53CB\u5584\u8BCD\uFF08\u9017\u53F7\u5206\u9694\uFF09", "hostileWords", 2, "\u5185\u7F6E\u8BCD\u8868\u4E4B\u5916\u518D\u52A0");
  const advE = fold(c2, "\u5F15\u5BFC\u8BDD\u672F\u4E0E\u6E38\u620F\u6307\u4EE4\uFF08\u8FDB\u9636\uFF09");
  boolField(advE, "\u7A7F\u63D2\u5F15\u5BFC\u8BDD\u672F\uFF08\u4E0A\u8230 / \u52A0\u7FA4 / \u62C9\u7EA2\u7C89\uFF09", "promoCue");
  numField(advE, "\u4E24\u6761\u5F15\u5BFC\u6700\u77ED\u95F4\u9694\uFF08\u79D2\uFF09", "promoGapSec", "\u9ED8\u8BA4 600 \u79D2\u4E00\u6B21\uFF0C\u592A\u5BC6\u50CF\u7535\u89C6\u8D2D\u7269");
  areaField(advE, "\u5F15\u5BFC\u8BDD\u672F\u8F6E\u6362\uFF08\u4E00\u884C\u4E00\u6761\uFF09", "promoTopics", 3, "\u6309\u987A\u5E8F\u8F6E\u7740\u8BF4");
  areaField(advE, "\u6E38\u620F\u63D2\u4EF6\u6307\u4EE4\u6B63\u5219\uFF08\u4E00\u884C\u4E00\u6761\uFF09", "blockPatterns", 4, "\u732B\u732B\u517B\u6210\uFF1A\u55B5 / \u5DE63 / \u8D2D\u4E7012 \u2026");
  const c3 = ui.section("\u{1F4E4} \u8BDD\u600E\u4E48\u9001\u51FA\u53BB", "\u6C14\u6CE1 + \u76F4\u64AD\u95F4\u5F39\u5E55 + QQ \u540C\u6B65\u3002");
  cols.append(c3);
  boolField(c3, "\u56DE\u590D\u540C\u6B65\u53D1\u5230\u76F4\u64AD\u95F4\u5F39\u5E55", "sendDanmaku");
  boolField(c3, "\u4E3B\u4EBA\u5BF9\u8BDD\u4E5F\u540C\u6B65\u5230\u5F39\u5E55", "mirrorUnownedSay");
  const advGuard = fold(c3, "\u5F39\u5E55\u654F\u611F\u8BCD\uFF08\u9632 B \u7AD9\u5C4F\u853D / \u9632\u6CC4\u5BC6\uFF09");
  boolField(advGuard, "\u53D1\u5F39\u5E55\u524D\u8FC7\u6EE4\u654F\u611F\u8BCD", "danmakuGuard");
  textField(advGuard, "\u53D1\u5F39\u5E55\u65F6\u5C4F\u853D\u7684\u8BCD\uFF08\u9017\u53F7\u5206\u9694\uFF09", "danmakuBlockWords", "\u5185\u7F6E\u5DF2\u56FA\u5B9A\u62E6\u4E09\u7C7B\uFF1A\u91D1\u989D\uFF08\u6570\u5B57+\u5143/\u5757/\u4E07\u3001\u6253\u8D4F\u3001\u5145\u503C\u3001\u6536\u5165\u3001\u5DE5\u8D44\u3001\u5206\u6210\uFF09\u3001\u8054\u7CFB\u65B9\u5F0F\uFF08QQ \u53F7\u3001\u5FAE\u4FE1\u53F7\u3001\u624B\u673A\u53F7\uFF09\u3001\u5E73\u53F0\u654F\u611F\u8BCD\uFF08\u5916\u6302\u3001\u811A\u672C\u3001\u5237\u91CF\u3001\u4E70\u7C89\uFF09\u3002\u8FD9\u91CC\u53EA\u8865\u4F60\u60F3\u989D\u5916\u62E6\u7684\uFF1B\u89C2\u4F17\u8BF4\u4EC0\u4E48\u4E0D\u56DE\uFF0C\u53BB\u4E0B\u9762\u300C\u5C4F\u853D\u8BCD\u4E0E\u540D\u5355\u300D\u914D\u3002");
  const advA = fold(c3, "\u5F39\u5E55\u7EC6\u8282\uFF08\u5B57\u6570 / \u95F4\u9694 / \u989C\u6587\u5B57 / \u52A8\u4F5C\uFF09");
  numField(advA, "\u4E00\u6761\u5F39\u5E55\u6700\u591A\u591A\u5C11\u5B57", "danmakuMaxLen", "B\u7AD9\u76F4\u64AD\u95F4\u5B9E\u6D4B\u4E0A\u9650 80");
  numField(advA, "\u4E24\u6761\u5F39\u5E55\u6700\u77ED\u95F4\u9694\uFF08\u79D2\uFF09", "danmakuGapSec", "\u4E0D\u591F\u95F4\u9694\u4F1A\u6392\u961F\u8865\u53D1");
  boolField(advA, "\u5F39\u5E55\u91CC\u5E26\u989C\u6587\u5B57", "emojiInDanmaku");
  numField(advA, "\u684C\u5BA0\u8868\u60C5\u52A8\u4F5C\u9891\u7387\uFF08\u6BCF N \u6761 1 \u6B21\uFF09", "petActionRate", "2 = \u6BCF\u4E24\u6761\u5E26\u4E00\u6B21\uFF1B0 = \u4E0D\u505A");
  numField(c1, "\u8230\u957F\u6BCF\u5929\u53EF\u753B\u51E0\u5F20\uFF080 = \u4E0D\u9650\uFF09", "guardDrawPerDay", "\u7528\u5B8C\u540E\u5979\u4F1A\u7EA6\u660E\u5929\uFF0C\u4E0D\u8C03\u753B\u56FE\u5DE5\u5177");
  numField(c3, "\u56DE\u5E94\u5B57\u6570\u4E0A\u9650", "replyMaxChars", "\u5199\u8FDB\u63D0\u793A\u8BCD\uFF0C\u5EFA\u8BAE 30~50");
  boolField(c3, "\u666E\u901A\u89C2\u4F17\u8FDB\u573A\u4E5F\u62DB\u547C\u4E00\u58F0", "sendEnter");
  numField(c3, "\u8FDB\u573A\u6B22\u8FCE\u7684\u7C89\u4E1D\u724C\u95E8\u69DB", "enterMedalLevel", "0 = \u4E0D\u770B\u724C\u5B50");
  boolField(c3, "\u628A\u56DE\u5E94\u8F6C\u53D1\u5230 QQ", "forwardToQq");
  textField(c3, "QQ \u76EE\u6807\uFF08\u7FA4\u53F7 / u:\u79C1\u804A\u53F7\uFF09", "qqForwardTargets");
  pickField(c3, "\u8F6C\u53D1\u683C\u5F0F", "qqForwardFormat", [
    { value: "important", label: "\u53EA\u8F6C @\u5979 / \u793C\u7269 / SC\uFF08\u63A8\u8350\uFF09" },
    { value: "full", label: "\u5E26\u89C2\u4F17\u539F\u8BDD" },
    { value: "reply", label: "\u53EA\u8F6C\u5979\u7684\u56DE\u5E94" }
  ]);
  const advB = fold(c3, "\u8F6C\u53D1\u9650\u901F \xB7 \u73B0\u573A\u901F\u62A5\uFF08\u8FDB\u9636\uFF0C\u4E00\u822C\u4E0D\u7528\u6539\uFF09");
  numField(advB, "\u540C\u4E00\u4E2A\u4EBA\u8F6C\u53D1\u95F4\u9694\uFF08\u79D2\uFF09", "qqForwardGapSec", "\u540C\u4E00\u4EBA 60 \u79D2\u5185\u53EA\u8F6C\u4E00\u6761\uFF1B\u4E0D\u540C\u4EBA\u4E92\u4E0D\u5F71\u54CD");
  boolField(advB, "\u8282\u6D41\u6309\u4EBA\u7B97\uFF08\u4E0D\u540C\u89C2\u4F17\u4E92\u4E0D\u6324\u5360\uFF09", "qqForwardPerUser");
  numField(advB, "\u4E24\u6761\u8F6C\u53D1\u6700\u5C0F\u95F4\u9694\uFF08\u79D2\uFF09", "qqForwardMinGapSec", "\u9632\u77AC\u95F4\u8FDE\u53D1\uFF1B0 = \u4E0D\u9650");
  numField(advB, "\u6BCF\u5206\u949F\u6700\u591A\u8F6C\u53D1\u51E0\u6761", "qqForwardMaxPerMin", "\u8D85\u51FA\u7684\u8FD9\u6761\u76F4\u63A5\u4E22\uFF0C\u65E5\u5FD7\u5199\u539F\u56E0\uFF1B0 = \u4E0D\u9650");
  numField(advB, "\u73B0\u573A\u901F\u62A5\u95F4\u9694\uFF08\u79D2\uFF0C0 = \u5173\uFF09", "qqDigestSec", "\u76F4\u64AD\u4E2D\u6BCF N \u79D2\u53D1\u4E00\u6761\u300C\u5728\u7EBF\u4EBA\u6570 + \u521A\u53D1\u751F\u4EC0\u4E48 + \u5979\u7684\u539F\u8BDD + \u5165\u53E3\u300D");
  const advC = fold(c3, "\u5F00\u64AD / \u4E0B\u64AD\u64AD\u62A5\uFF08\u8FDB\u9636\uFF09");
  boolField(advC, "\u5F00\u64AD / \u4E0B\u64AD\u81EA\u52A8\u5728\u7FA4\u91CC\u64AD\u62A5", "autoLiveNotice");
  textField(advC, "\u64AD\u62A5\u53D1\u5230\u54EA\uFF08\u7FA4\u53F7 / u:QQ\uFF09", "liveNoticeTarget");
  numField(advC, "\u4E24\u6761\u64AD\u62A5\u6700\u77ED\u95F4\u9694\uFF08\u79D2\uFF09", "liveNoticeGapSec");
  numField(advC, "\u6BCF\u5929\u6700\u591A\u64AD\u62A5\u51E0\u6761", "liveNoticeMaxPerDay");
  const noticeRow = ui.rowbar();
  const btnPreview = ui.button("\u9884\u89C8\u64AD\u62A5\u6307\u4EE4", {
    size: "sm",
    onClick: () => {
      void (async () => {
        try {
          const r = await ctx.invoke("noticePreview");
          msg.info(`\u4ECA\u5929\u5DF2\u53D1 ${r.todayCount}/${r.cap} \u6761`);
          ui.drawer("\u64AD\u62A5\u6307\u4EE4\u9884\u89C8", `${r.start}

\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

${r.stop}`);
        } catch (e) {
          msg.error(`\u9884\u89C8\u5931\u8D25\uFF1A${String(e).slice(0, 90)}`);
        }
      })();
    }
  });
  const btnTest = ui.button("\u8BD5\u53D1\u4E00\u6761\u5F00\u64AD", {
    size: "sm",
    onClick: () => {
      void (async () => {
        const ok = await ui.confirm({ title: "\u73B0\u5728\u771F\u7684\u53D1\u4E00\u6761\u5F00\u64AD\u901A\u77E5\uFF1F", body: "\u4F1A\u6309\u4E0A\u9762\u300C\u64AD\u62A5\u53D1\u5230\u54EA\u300D\u7684\u76EE\u6807\u53D1\u9001\u3002" });
        if (!ok) return;
        try {
          await ctx.invoke("noticeTest", ["start"]);
          msg.info("\u5DF2\u8BA9 agent \u53BB\u53D1\uFF0C\u51E0\u79D2\u540E\u770B\u7FA4");
        } catch (e) {
          msg.error(`\u8BD5\u53D1\u5931\u8D25\uFF1A${String(e).slice(0, 90)}`);
        }
      })();
    }
  });
  noticeRow.append(btnPreview, btnTest);
  c3.append(noticeRow);
  const top = ui.section("\u{1F3AE} \u672C\u5C40\u6E38\u620F\uFF08\u6362\u6E38\u620F\u53EA\u6539\u8FD9\u4E00\u5757\uFF09", "\u9053\u5177\u8868\u4E00\u884C\u4E00\u6761\u300C\u9635\u8425|\u793C\u7269|\u6548\u679C\u300D\uFF0C\u7EA2\u7C89=\u5E2E\u4E3B\u64AD\u3001\u9ED1\u7C89=\u6574\u86CA\u3002\u6362\u6E38\u620F\u6574\u5757\u66FF\u6362\uFF0C\u65E7\u5185\u5BB9\u4E0D\u7559\u75D5\u3002");
  colsTop.append(top);
  textField(top, "\u6E38\u620F\u540D", "gameName", "\u4F8B\uFF1A\u5C0F\u5B69\u8FC7\u9A6C\u8DEF 1.1");
  areaField(top, "\u73A9\u6CD5\u7B80\u4ECB\uFF08\u5199\u4E24\u4E09\u53E5\uFF09", "gameBrief", 3, "\u4F8B\uFF1A\u628A\u5C0F\u5B69\u4ECE\u53F3\u8FB9\u9001\u5230\u5DE6\u8FB9\uFF0C\u88AB\u8F66\u649E\u5C31\u6389\uFF1B\u5DE6\u4E0A\u89D2\u6E05\u96F6\u624D\u80FD\u4E0B\u64AD");
  areaField(top, "\u9053\u5177\u8868\uFF08\u9635\u8425|\u793C\u7269|\u6548\u679C\uFF09", "gameItems", 8, "\u7EA2\u7C89|\u7C89\u4E1D\u56E2\u706F\u724C|\u8DEF\u969C+\u52A0\u901F\u8DD110\u79D2");
  areaField(top, "\u89C4\u5219\u4E0E\u672F\u8BED\uFF08\u4E00\u884C\u4E00\u6761\uFF09", "gameRules", 5, "\u66B4\u51FB\uFF1A\u957F\u6309 10/100/520 \u4E2A\uFF0C\u6BCF 10 \u4E2A\u8F6C\u4E00\u6B21\u76D8\uFF0C\u500D\u7387 1~5");
  const adv = document.createElement("details");
  adv.style.cssText = "margin-top:16px;";
  const sum = document.createElement("summary");
  sum.textContent = "\u9AD8\u7EA7 / \u8FDE\u63A5\u53C2\u6570\uFF08\u5E73\u65F6\u4E0D\u7528\u52A8\uFF09";
  sum.style.cssText = "cursor:pointer;opacity:.75;font-size:13px;padding:6px 0;";
  adv.append(sum);
  const advGrid = grid("repeat(auto-fit, minmax(260px, 1fr))");
  advGrid.style.marginTop = "10px";
  adv.append(advGrid);
  sheet.body.append(adv);
  const a1 = ui.section("\u8FDE\u63A5");
  const a2 = ui.section("\u5E95\u5C42\u5F00\u5173");
  advGrid.append(a1, a2);
  textField(a1, "\u5F39\u5E55\u6765\u6E90\u5730\u5740", "streamUrl", "\u6539\u5B8C\u8981\u91CD\u542F World");
  numField(a1, "\u53D1\u5F39\u5E55\u7684\u76F4\u64AD\u95F4\u53F7", "danmakuRoomId");
  textField(a1, "bili_jct", "danmakuBiliJct");
  textField(a1, "Cookie\uFF08\u7559\u7A7A\u5219\u590D\u7528 B\u7AD9\u63D2\u4EF6\uFF09", "danmakuCookie");
  boolField(a2, "\u4ECE\u4E8B\u4EF6\u5E93\u8BFB\u793C\u7269/SC/\u4E0A\u8230\uFF08\u5FC5\u987B\u5F00\uFF09", "useStoreEvents");
  numField(a2, "\u603B\u9650\u9891\uFF08\u79D2\uFF0C0 = \u4E0D\u542F\u7528\uFF09", "gapSec", "\u6700\u4F4E\u4F18\u5148\u7EA7\u7684\u300C\u6BCF X \u5206\u949F\u4E00\u6761\u300D\u603B\u95F8");
  textField(a2, "\u5979\u81EA\u5DF1\u7684\u6635\u79F0\uFF08\u9632\u81EA\u56DE\u58F0\uFF09", "selfNames");
  boolField(a2, "\u4EBA\u6C14/\u699C\u5355\u4E5F\u63A8\u7ED9\u6A21\u578B", "sendAudience");
  void (async () => {
    try {
      cfg = await ctx.invoke("load");
      for (const b of binders) {
        try {
          b.apply();
        } catch {
        }
      }
      for (const el of Array.from(sheet.body.querySelectorAll("input, textarea, select"))) {
        const node = el;
        const labelEl = node.closest("label");
        const text = (labelEl?.textContent || "").replace(/：$/, "").trim();
        const hit = KEYS.find((k) => text.startsWith(k.label));
        if (!hit) continue;
        const v = cfg[hit.field];
        if (node instanceof HTMLInputElement && node.type === "checkbox") node.checked = Boolean(v);
        else if (v !== void 0 && v !== null && v !== "") node.value = String(v);
      }
      msg.info("\u5DF2\u8BFB\u53D6\u5F53\u524D\u914D\u7F6E");
    } catch (e) {
      msg.error(`\u8BFB\u53D6\u914D\u7F6E\u5931\u8D25\uFF1A${String(e).slice(0, 90)}`);
    }
  })();
}
const KEYS = [
  { label: "\u793C\u7269\u95E8\u69DB\uFF08\u5143\uFF09", field: "minGiftYuan" },
  { label: "\u5C0F\u989D\u793C\u7269\u4E5F\u63A5\u4E00\u53E5", field: "cheapGiftAsChance" },
  { label: "\u9192\u76EE\u7559\u8A00 SC \u5FC5\u56DE", field: "replyOnSuperChat" },
  { label: "SC \u8BFB\u5B8C\u518D\u56DE\uFF08\u79D2\uFF09", field: "scDelaySec" },
  { label: "\u4E0A\u8230\u5FC5\u56DE", field: "replyOnGuard" },
  { label: "\u8230\u957F / \u63D0\u7763 / \u603B\u7763 \u8FDB\u573A\u5FC5\u6B22\u8FCE", field: "guardWelcome" },
  { label: "\u6BCF\u4EBA\u6BCF\u5929\u6700\u591A\u6B22\u8FCE\u51E0\u6B21", field: "guardWelcomePerDay" },
  { label: "\u6B22\u8FCE\u8BCD\u98CE\u683C\u63D0\u793A\uFF08\u53EF\u7559\u7A7A\uFF09", field: "guardWelcomeStyles" },
  { label: "\u673A\u4F1A\u578B\u6700\u77ED\u95F4\u9694\uFF08\u79D2\uFF09", field: "chanceGapSec" },
  { label: "\u6BCF\u5C0F\u65F6\u4E0A\u9650\uFF08\u6761\uFF09", field: "maxPerHour" },
  { label: "\u6709\u4EBA\u53EB\u5979\u5C31\u56DE\uFF08\u540D\u5B57 / @\uFF09", field: "replyOnAt" },
  { label: "\u8BA4\u8FD9\u4E9B\u8BCD\u7B97\u53EB\u5979\uFF08\u9017\u53F7\u5206\u9694\uFF09", field: "atKeywords" },
  { label: "\u95EE\u53E5\u4E5F\u63A5", field: "replyOnQuestion" },
  { label: "\u8FC7\u6EE4\u566A\u58F0\uFF08666 / \u7EAF\u8868\u60C5 / \u5237\u5C4F\uFF09", field: "blockNoise" },
  { label: "\u8FC7\u6EE4\u8FB1\u9A82\u4E0E\u8D76\u4EBA", field: "blockHostile" },
  { label: "\u8BF4\u7ED9\u522B\u4EBA\u7684\u4E0D\u63D2\u8BDD", field: "blockPeerChat" },
  { label: "\u5C4F\u853D\u7528\u6237\uFF08\u9017\u53F7\u5206\u9694\uFF0C\u6A21\u7CCA\u5339\u914D\uFF09", field: "blockUsers" },
  { label: "\u5C4F\u853D\u8BCD\uFF08\u9017\u53F7\u5206\u9694\uFF09", field: "blockWords" },
  { label: "\u989D\u5916\u4E0D\u53CB\u5584\u8BCD\uFF08\u9017\u53F7\u5206\u9694\uFF09", field: "hostileWords" },
  { label: "\u56DE\u590D\u540C\u6B65\u53D1\u5230\u76F4\u64AD\u95F4\u5F39\u5E55", field: "sendDanmaku" },
  { label: "\u4E00\u6761\u5F39\u5E55\u6700\u591A\u591A\u5C11\u5B57", field: "danmakuMaxLen" },
  { label: "\u4E24\u6761\u5F39\u5E55\u6700\u77ED\u95F4\u9694\uFF08\u79D2\uFF09", field: "danmakuGapSec" },
  { label: "\u56DE\u5E94\u5B57\u6570\u4E0A\u9650", field: "replyMaxChars" },
  { label: "\u666E\u901A\u89C2\u4F17\u8FDB\u573A\u4E5F\u62DB\u547C\u4E00\u58F0", field: "sendEnter" },
  { label: "\u8FDB\u573A\u6B22\u8FCE\u7684\u7C89\u4E1D\u724C\u95E8\u69DB", field: "enterMedalLevel" },
  { label: "\u628A\u56DE\u5E94\u8F6C\u53D1\u5230 QQ", field: "forwardToQq" },
  { label: "QQ \u76EE\u6807\uFF08\u7FA4\u53F7 / u:\u79C1\u804A\u53F7\uFF09", field: "qqForwardTargets" },
  { label: "\u8F6C\u53D1\u683C\u5F0F", field: "qqForwardFormat" },
  { label: "\u540C\u4E00\u4E2A\u4EBA\u8F6C\u53D1\u95F4\u9694\uFF08\u79D2\uFF09", field: "qqForwardGapSec" },
  { label: "\u8282\u6D41\u6309\u4EBA\u7B97", field: "qqForwardPerUser" },
  { label: "\u4E24\u6761\u8F6C\u53D1\u6700\u5C0F\u95F4\u9694\uFF08\u79D2\uFF09", field: "qqForwardMinGapSec" },
  { label: "\u6BCF\u5206\u949F\u6700\u591A\u8F6C\u53D1\u51E0\u6761", field: "qqForwardMaxPerMin" },
  { label: "\u73B0\u573A\u901F\u62A5\u95F4\u9694\uFF08\u79D2\uFF09", field: "qqDigestSec" },
  { label: "\u5F39\u5E55\u6765\u6E90\u5730\u5740", field: "streamUrl" },
  { label: "\u53D1\u5F39\u5E55\u7684\u76F4\u64AD\u95F4\u53F7", field: "danmakuRoomId" },
  { label: "bili_jct", field: "danmakuBiliJct" },
  { label: "Cookie\uFF08\u7559\u7A7A\u5219\u590D\u7528 B\u7AD9\u63D2\u4EF6\uFF09", field: "danmakuCookie" },
  { label: "\u4ECE\u4E8B\u4EF6\u5E93\u8BFB\u793C\u7269/SC/\u4E0A\u8230\uFF08\u5FC5\u987B\u5F00\uFF09", field: "useStoreEvents" },
  { label: "\u603B\u9650\u9891\uFF08\u79D2\uFF0C0 = \u4E0D\u542F\u7528\uFF09", field: "gapSec" },
  { label: "\u89C2\u4F17\u8363\u8A89\u7B49\u7EA7\u95E8\u69DB\uFF080 = \u4E0D\u9650\u5236\uFF09", field: "minUserLevel" },
  { label: "\u5979\u81EA\u5DF1\u7684\u6635\u79F0\uFF08\u9632\u81EA\u56DE\u58F0\uFF09", field: "selfNames" },
  { label: "\u4EBA\u6C14/\u699C\u5355\u4E5F\u63A8\u7ED9\u6A21\u578B", field: "sendAudience" },
  { label: "\u73A9\u6CD5\u7B80\u4ECB\uFF08\u5199\u4E24\u4E09\u53E5\uFF09", field: "gameBrief" },
  { label: "\u6E38\u620F\u540D", field: "gameName" },
  { label: "\u9053\u5177\u8868\uFF08\u9635\u8425|\u793C\u7269|\u6548\u679C\uFF09", field: "gameItems" },
  { label: "\u89C4\u5219\u4E0E\u672F\u8BED\uFF08\u4E00\u884C\u4E00\u6761\uFF09", field: "gameRules" },
  { label: "\u5F00\u64AD / \u4E0B\u64AD\u81EA\u52A8\u5728\u7FA4\u91CC\u64AD\u62A5", field: "autoLiveNotice" },
  { label: "\u64AD\u62A5\u53D1\u5230\u54EA\uFF08\u7FA4\u53F7 / u:QQ\uFF09", field: "liveNoticeTarget" },
  { label: "\u4E24\u6761\u64AD\u62A5\u6700\u77ED\u95F4\u9694\uFF08\u79D2\uFF09", field: "liveNoticeGapSec" },
  { label: "\u6BCF\u5929\u6700\u591A\u64AD\u62A5\u51E0\u6761", field: "liveNoticeMaxPerDay" },
  { label: "\u7A7F\u63D2\u5F15\u5BFC\u8BDD\u672F", field: "promoCue" },
  { label: "\u4E24\u6761\u5F15\u5BFC\u6700\u77ED\u95F4\u9694\uFF08\u79D2\uFF09", field: "promoGapSec" },
  { label: "\u5F15\u5BFC\u8BDD\u672F\u8F6E\u6362\uFF08\u4E00\u884C\u4E00\u6761\uFF09", field: "promoTopics" },
  { label: "\u6E38\u620F\u63D2\u4EF6\u6307\u4EE4\u6B63\u5219\uFF08\u4E00\u884C\u4E00\u6761\uFF09", field: "blockPatterns" },
  { label: "\u6E38\u620F\u9053\u5177\u793C\u7269\u5FC5\u56DE\uFF08\u4E0D\u770B\u91D1\u989D\uFF09", field: "gameGiftAlwaysReply" },
  { label: "\u623F\u7BA1/\u8230\u957F\u8FDE\u53D1\u95F4\u9694\uFF08\u79D2\uFF09", field: "guardBurstSec" },
  { label: "\u540C\u4E00\u4EBA\u4E24\u6761\u95F4\u9694\uFF08\u79D2\uFF09", field: "sameUserGapSec" },
  { label: "\u5F39\u5E55\u91CC\u5E26 B\u7AD9\u8868\u60C5 / \u989C\u6587\u5B57", field: "emojiInDanmaku" },
  { label: "\u793C\u7269\u5408\u5E76\u7A97\u53E3\uFF08\u79D2\uFF09", field: "giftMergeSec" },
  { label: "\u5927\u989D\u793C\u7269\u95E8\u69DB\uFF08\u5143\uFF09", field: "bigGiftYuan" },
  { label: "\u684C\u5BA0\u8868\u60C5\u52A8\u4F5C\u9891\u7387\uFF08\u6BCF N \u6761 1 \u6B21\uFF09", field: "petActionRate" },
  { label: "\u8230\u957F\u6BCF\u5929\u53EF\u753B\u51E0\u5F20\uFF080 = \u4E0D\u9650\uFF09", field: "guardDrawPerDay" }
];
function mountQqSync(ctx) {
  const ui = ctx.ui;
  const sheet = ui.sheet({
    title: "QQ \u540C\u6B65\u6C14\u6CE1",
    desc: "\u5979\u53D1\u5F80 QQ \u7684\u6BCF\u4E00\u6761\u6D88\u606F\uFF08\u7FA4\u804A\u3001\u79C1\u804A\u90FD\u7B97\uFF09\uFF0C\u90FD\u4F1A\u5728\u8FD9\u91CC\u9010\u6761\u8BB0\u5F55\u4E00\u6B21\uFF08\u53BB\u91CD\uFF0C\u6700\u591A 100 \u6761\uFF09\u3002"
  });
  ctx.root.append(sheet.el);
  const seg = ui.segmented(
    [
      { value: "on", label: "\u5F00\u542F" },
      { value: "off", label: "\u5173\u95ED" }
    ],
    {
      value: "on",
      onSelect: (v) => {
        void (async () => {
          try {
            await ctx.invoke("setEnabled", [v === "on"]);
            await refresh();
          } catch (e) {
            msg.error(`\u4FDD\u5B58\u5931\u8D25\uFF1A${String(e).slice(0, 80)}`);
          }
        })();
      }
    }
  );
  const rowbar = ui.rowbar();
  const btnRefresh = ui.button("\u5237\u65B0", { size: "sm", onClick: () => void refresh() });
  const btnClear = ui.button("\u6E05\u7A7A\u8BB0\u5F55", {
    size: "sm",
    onClick: () => {
      void (async () => {
        try {
          await ctx.invoke("clear");
          await refresh();
          msg.info("\u5DF2\u6E05\u7A7A");
        } catch (e) {
          msg.error(`\u6E05\u7A7A\u5931\u8D25\uFF1A${String(e).slice(0, 80)}`);
        }
      })();
    }
  });
  rowbar.append(btnRefresh, btnClear);
  const msg = ui.msgline();
  const table = ui.table({ head: ["\u65F6\u95F4", "\u6E20\u9053", "\u5185\u5BB9"], maxHeight: "calc(100vh - 420px)" });
  sheet.body.append(seg.el, rowbar, msg, table.el);
  async function refresh() {
    try {
      const data = await ctx.invoke("list");
      try {
        seg.setValue?.(data.enabled ? "on" : "off");
      } catch {
      }
      if (!data.items.length) {
        table.clear("\u8FD8\u6CA1\u6709\u8BB0\u5F55\u3002\u7B49\u5979\u5728\u7FA4\u91CC\u8BF4\u8BDD\u540E\uFF0C\u8FD9\u91CC\u4F1A\u51FA\u73B0\u6761\u76EE\u3002");
        msg.info(data.enabled ? "\u540C\u6B65\u5DF2\u5F00\u542F" : "\u540C\u6B65\u5DF2\u5173\u95ED");
        return;
      }
      table.clear();
      for (const it of data.items.slice().reverse()) {
        table.addRow([
          it.ts,
          { text: it.kind === "group" ? "\u7FA4" : "\u79C1\u804A", cls: "mono" },
          { text: it.text, cls: "txt" }
        ]);
      }
      msg.info(`${data.enabled ? "\u540C\u6B65\u5DF2\u5F00\u542F" : "\u540C\u6B65\u5DF2\u5173\u95ED"} \xB7 \u5171 ${data.count} \u6761`);
    } catch (e) {
      msg.error(`\u8BFB\u53D6\u5931\u8D25\uFF1A${String(e).slice(0, 100)}`);
    }
  }
  void refresh();
  ctx.interval(() => void refresh(), 5e3);
}
function mountLiveStats(ctx) {
  const ui = ctx.ui;
  const sheet = ui.sheet({
    title: "\u73B0\u573A\u5B9E\u51B5",
    desc: "\u4E3A\u4EC0\u4E48\u56DE\u3001\u4E3A\u4EC0\u4E48\u4E0D\u56DE\uFF0C\u5168\u5728\u8FD9\u91CC\u3002\u5F00\u64AD\u65F6\u76EF\u7740\u300C\u8DF3\u8FC7\u539F\u56E0\u300D\u5C31\u80FD\u5224\u65AD\u662F\u4E0D\u662F\u8FC7\u6EE4\u592A\u72E0\u3002"
  });
  ctx.root.append(sheet.el);
  const msg = ui.msgline();
  const stats = ui.statgrid([]);
  const skipLine = ui.msgline();
  const rowbar = ui.rowbar();
  rowbar.append(ui.button("\u5237\u65B0", { size: "sm", onClick: () => void refresh() }));
  const table = ui.table({
    head: ["\u65F6\u95F4", "\u7C7B\u578B", "\u89C2\u4F17", "\u5185\u5BB9", "\u5904\u7406", "\u539F\u56E0"],
    maxHeight: "420px"
  });
  sheet.body.append(stats, msg, skipLine, rowbar, table.el);
  async function refresh() {
    try {
      const d = await ctx.invoke("list");
      stats.replaceChildren(
        ui.stat({ k: "\u5FC5\u56DE", v: String(d.counters.must) }),
        ui.stat({ k: "\u673A\u4F1A\u578B", v: String(d.counters.chance) }),
        ui.stat({ k: "\u8FC7\u6EE4", v: String(d.counters.skipped) }),
        ui.stat({ k: "\u4E8B\u4EF6\u5E93", v: String(d.store).includes("\u5DF2\u63A5\u5165") ? "\u5DF2\u63A5\u5165" : "\u672A\u63A5\u5165" })
      );
      const skips = Object.entries(d.skips || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
      skipLine.info(skips.length ? `\u8DF3\u8FC7\u539F\u56E0\uFF1A${skips.map(([k, v]) => `${k} ${v}`).join(" \xB7 ")}` : "\u8FD8\u6CA1\u6709\u8DF3\u8FC7\u8BB0\u5F55");
      if (!d.decisions.length) {
        table.clear();
        table.addRow([
          "\u2014",
          "\u2014",
          "\u2014",
          { text: "\u8FD8\u6CA1\u6709\u5224\u5B9A\u8BB0\u5F55\u3002\u5F00\u64AD\u540E\u8FD9\u91CC\u4F1A\u9010\u6761\u51FA\u73B0\uFF08\u6536\u5230\u5F39\u5E55 1 \u79D2\u5185\u5C31\u6709\uFF09\u3002", cls: "txt" },
          "\u2014",
          "\u2014"
        ]);
        msg.info(`\u8FD8\u6CA1\u6536\u5230\u5F39\u5E55 \xB7 \u8BA1\u6570\uFF1A\u5FC5\u56DE ${d.counters.must} / \u673A\u4F1A ${d.counters.chance} / \u8FC7\u6EE4 ${d.counters.skipped}`);
        return;
      }
      table.clear();
      const rows = d.decisions.slice().reverse();
      for (const it of rows) {
        table.addRow([
          String(it.ts ?? ""),
          String(it.kind ?? ""),
          String(it.user ?? ""),
          { text: String(it.body || "\u2014"), cls: "txt" },
          String(it.action ?? ""),
          { text: String(it.reason ?? ""), cls: "mono" }
        ]);
      }
      if (!table.body.children.length && rows.length) {
        msg.error(`\u8868\u683C\u6E32\u67D3\u5F02\u5E38\uFF0C\u6700\u8FD1 ${Math.min(5, rows.length)} \u6761\uFF1A` + rows.slice(0, 5).map((r) => `${r.ts} ${r.action} ${r.reason}`).join(" \uFF5C "));
        return;
      }
      msg.info(`\u6700\u8FD1 ${d.decisions.length} \u6761\u5224\u5B9A \xB7 \u5979\u6700\u8FD1\u8BF4\u8FC7\uFF1A${(d.recentReplies || []).slice(-2).join(" / ") || "\u2014"}`);
    } catch (e) {
      msg.error(`\u8BFB\u53D6\u5931\u8D25\uFF1A${String(e).slice(0, 100)}`);
    }
  }
  void refresh();
  ctx.interval(() => void refresh(), 4e3);
}
function mountOverlay(ctx) {
  const ui = ctx.ui;
  const sheet = ui.sheet({
    title: "\u76F4\u64AD\u753B\u9762\uFF08Overlay\uFF09",
    desc: "\u8FD9\u91CC\u662F\u300C\u62FF\u5730\u5740 + \u6253\u5F00\u770B\u300D\u7684\u5730\u65B9\uFF0C\u4E0D\u662F\u5FC5\u987B\u5185\u5D4C\u9884\u89C8\u3002\u6CA1\u5F39\u5E55/\u793C\u7269\u65F6\u753B\u9762\u672C\u6765\u5C31\u7A7A\uFF0C\u5C5E\u6B63\u5E38\u3002"
  });
  ctx.root.append(sheet.el);
  const msg = ui.msgline();
  const bar = ui.rowbar();
  const stage = document.createElement("div");
  stage.style.cssText = "margin-top:10px;border:1px dashed rgba(255,255,255,.18);border-radius:10px;padding:22px 18px;line-height:1.9;font-size:13px;color:#c9cfda;background:rgba(255,255,255,.02)";
  const info = { overlayUrl: "", previewUrl: "", editorUrl: "" };
  let frameMounted = false;
  const showCard = () => {
    stage.replaceChildren();
    const h = document.createElement("div");
    h.style.cssText = "font-size:14px;font-weight:600;color:#e6e8eb;margin-bottom:8px";
    h.textContent = "OBS \u5730\u5740\uFF08\u586B\u8FDB\u300C\u6D4F\u89C8\u5668\u300D\u6E90\uFF0C1920\xD71080\uFF0C\u52FE\u9009\u900F\u660E\uFF09";
    const url = document.createElement("div");
    url.textContent = info.overlayUrl || "\uFF08\u8FD8\u6CA1\u8BFB\u5230\u5730\u5740\uFF09";
    url.style.cssText = "font-family:ui-monospace,Consolas,monospace;font-size:13px;padding:9px 11px;border-radius:8px;background:rgba(0,0,0,.35);word-break:break-all;margin-bottom:12px";
    const tip = document.createElement("div");
    tip.style.cssText = "color:#9aa3b2;font-size:12.5px";
    tip.innerHTML = "\xB7 <b>\u60F3\u5728 Coo \u91CC\u770B</b>\uFF1A\u70B9\u300C\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u300D\u2014\u2014\u4F1A\u7528\u7CFB\u7EDF\u6D4F\u89C8\u5668\u6253\u5F00\u68CB\u76D8\u683C\u9884\u89C8\uFF0C\u4E00\u5B9A\u80FD\u770B\u5230\u3002<br>\xB7 <b>\u753B\u9762\u662F\u7A7A\u767D</b>\uFF1A\u8BF4\u660E\u8FD9\u4E00\u523B\u6CA1\u6709\u5F39\u5E55/\u793C\u7269\u8FDB\u6765\uFF0C\u5C5E\u6B63\u5E38\uFF0C\u4E0D\u662F\u574F\u4E86\u3002<br>\xB7 <b>\u60F3\u5728\u9762\u677F\u91CC\u5185\u5D4C</b>\uFF1A\u53EF\u4EE5\u70B9\u300C\u4ECD\u7136\u5185\u5D4C\u8BD5\u8BD5\u300D\uFF0C\u4F46\u90E8\u5206\u5B89\u5168\u7B56\u7565\u4F1A\u62E6\uFF0C\u767D\u5C4F\u5C31\u662F\u90A3\u4E2A\u539F\u56E0\u3002";
    stage.append(h, url, tip);
  };
  const mountFrame = async () => {
    const src = info.previewUrl || info.overlayUrl;
    if (!src) return;
    frameMounted = true;
    stage.replaceChildren();
    try {
      await fetch(src, { mode: "no-cors", cache: "no-store" });
    } catch {
      msg.error("\u5185\u5D4C\u901A\u9053\u88AB\u7CFB\u7EDF\u7B56\u7565\u62E6\u4E86\uFF08\u9875\u9762\u672C\u8EAB\u6CA1\u574F\uFF09\u3002\u7528\u300C\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u300D\u5373\u53EF\u3002");
      frameMounted = false;
      showCard();
      return;
    }
    const frame = document.createElement("iframe");
    frame.style.width = "100%";
    frame.style.height = "calc(100vh - 360px)";
    frame.style.minHeight = "280px";
    frame.style.border = "0";
    frame.style.borderRadius = "10px";
    frame.style.background = "rgba(0,0,0,.35)";
    frame.src = src;
    stage.append(frame);
    msg.info("\u5DF2\u5C1D\u8BD5\u5185\u5D4C\u3002\u82E5\u4ECD\u662F\u767D\u677F\uFF0C\u8BF4\u660E\u88AB\u62E6\u4E86\u2014\u2014\u70B9\u300C\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u300D\u5C31\u884C\u3002");
  };
  const openInBrowser = () => {
    const url = info.previewUrl || info.overlayUrl;
    if (url) window.open(url, "_blank");
  };
  bar.append(
    ui.button("\u5728\u6D4F\u89C8\u5668\u6253\u5F00", { size: "sm", variant: "primary", onClick: openInBrowser }),
    ui.button("\u6253\u5F00\u7F16\u8F91\u5668", {
      size: "sm",
      onClick: () => {
        const url = info.editorUrl || info.overlayUrl;
        if (url) window.open(url, "_blank");
      }
    }),
    ui.button("\u590D\u5236 OBS \u5730\u5740", {
      size: "sm",
      onClick: () => {
        if (!info.overlayUrl) return;
        navigator.clipboard?.writeText(info.overlayUrl).then(() => msg.info(`\u5DF2\u590D\u5236\uFF1A${info.overlayUrl}`)).catch(() => msg.error(`\u590D\u5236\u5931\u8D25\uFF0C\u624B\u52A8\u590D\u5236\uFF1A${info.overlayUrl}`));
      }
    }),
    ui.button("\u4ECD\u7136\u5185\u5D4C\u8BD5\u8BD5", { size: "sm", onClick: () => void mountFrame() })
  );
  sheet.body.append(bar, msg, stage);
  const load = async () => {
    try {
      const d = await Promise.race([
        ctx.invoke("info"),
        new Promise((_, rej) => setTimeout(() => rej(new Error("\u8BFB\u53D6\u5730\u5740\u8D85\u65F6\uFF085 \u79D2\uFF09")), 5e3))
      ]);
      info.overlayUrl = String(d?.overlayUrl || "");
      info.previewUrl = String(d?.previewUrl || "");
      info.editorUrl = String(d?.editorUrl || "");
      msg.info(`\u5730\u5740\u5DF2\u5C31\u7EEA \xB7 \u70B9\u300C\u5728\u6D4F\u89C8\u5668\u6253\u5F00\u300D\u770B\u9884\u89C8`);
      if (!frameMounted) showCard();
    } catch (e) {
      msg.error(`\u8BFB\u53D6\u5931\u8D25\uFF1A${String(e).slice(0, 90)}`);
      showCard();
    }
  };
  void load();
}
const bundle = {
  panels: {
    settings: { mount: mountSettings },
    "qq-sync": { mount: mountQqSync },
    overlay: { mount: mountOverlay },
    "live-stats": { mount: mountLiveStats }
  }
};
var client_default = bundle;
export {
  client_default as default
};
