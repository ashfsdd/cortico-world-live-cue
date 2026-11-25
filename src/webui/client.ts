/**
 * 直播弹幕桥 · 前端面板
 *
 * 三个面板：
 *   settings    —— 简化版设置（三列并排，改完自动保存）
 *   qq-sync     —— 她发往 QQ 的记录
 *   live-stats  —— 现场实况（必回/机会/过滤计数、跳过原因、最近判定）
 *   overlay     —— 直播画面（嵌 B站插件的 overlay 页，可预览/复制 OBS 地址）
 *
 * 全部用 ctx.ui 的原语（sheet / section / field / input / select / checkbox / table），
 * 只有分栏这一层用原生 div + CSS Grid —— 原语没有栅格，rowbar 排不出三列。
 */
import type { WebUiClientBundle, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';

type Cfg = Record<string, any>;

interface SyncItem { ts: string; text: string; kind: string; user: string }
interface ListResult { enabled: boolean; count: number; items: SyncItem[] }

// ───────────────────────────────────────────────
// 公共小工具
// ───────────────────────────────────────────────

function fold(parent: HTMLElement, title: string): HTMLElement {
  const d = document.createElement('details');
  d.style.cssText = 'margin:8px 0 2px;border:1px solid rgba(128,128,128,.22);border-radius:10px;padding:0 10px 6px;';
  const sum = document.createElement('summary');
  sum.textContent = title;
  sum.style.cssText = 'cursor:pointer;padding:9px 0;font-weight:600;opacity:.85;';
  const box = document.createElement('div');
  box.style.marginTop = '4px';
  d.append(sum, box);
  parent.append(d);
  return box;
}

function grid(cols: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `display:grid;grid-template-columns:${cols};gap:14px;align-items:start;`;
  return el;
}

function pair(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end;';
  return el;
}

// ───────────────────────────────────────────────
// 设置面板（简化 + 三列）
// ───────────────────────────────────────────────

function mountSettings(ctx: WebUiPanelContext): void {
  const ui = ctx.ui;
  const sheet = ui.sheet({
    title: '直播弹幕桥 · 设置',
    desc: '左列管「谁给钱、怎么回」，中间管「什么时候开口」，右列管「话怎么送出去」，最下面是连接参数。改完自动保存。',
  });
  ctx.root.append(sheet.el);

  const msg = ui.msgline();
  const colsTop = grid('1fr');
  colsTop.style.marginTop = '10px';
  sheet.body.append(msg, colsTop);

  let cfg: Cfg = {};
  const pending: Cfg = {};
  // 每个控件在创建时就把自己的字段名登记下来，load 完按字段名回填。
  // 以前是靠「标签文字匹配」回填——改个措辞就漏一个（颜文字开关就是这么坏的）。
  const binders: Array<{ key: string; apply: () => void }> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const set = (key: string, value: any): void => {
    cfg[key] = value;
    pending[key] = value;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), 450);
  };

  async function flush(): Promise<void> {
    timer = null;
    const patch: Cfg = { ...pending };
    const keys = Object.keys(patch);
    if (!keys.length) return;
    for (const k of keys) delete pending[k];
    try {
      await ctx.invoke('save', [patch]);
      msg.info(`已保存 ${keys.length} 项 · 立即生效（改连接地址需重启 World）`);
    } catch (e) {
      msg.error(`保存失败：${String(e).slice(0, 90)}`);
    }
  }

  const cols = grid('repeat(auto-fit, minmax(290px, 1fr))');
  sheet.body.append(cols);

  // 用 function 声明而不是 const 箭头：函数声明会整体提升，
  // 万一将来有人在定义之前调用，也不会抛 TDZ（Cannot access 'xxx' before initialization）。
  function numField(sec: HTMLElement, label: string, key: string, hint?: string): HTMLInputElement {
    const input = ui.input({
      type: 'number',
      value: String(cfg[key] ?? ''),
      onInput: (v) => set(key, v === '' ? 0 : Number(v)),
    });
    const field = ui.field(label, input);
    if (hint) field.title = hint;
    sec.append(field);
    binders.push({ key, apply: () => { input.value = cfg[key] == null ? '' : String(cfg[key]); } });
    return input;
  }

  function textField(sec: HTMLElement, label: string, key: string, hint?: string): void {
    const input = ui.input({
      value: String(cfg[key] ?? ''),
      onInput: (v) => set(key, v),
    });
    const field = ui.field(label, input);
    if (hint) field.title = hint;
    sec.append(field);
    binders.push({ key, apply: () => { input.value = cfg[key] == null ? '' : String(cfg[key]); } });
  }

  function areaField(sec: HTMLElement, label: string, key: string, rows = 3, placeholder = ''): void {
    const area = ui.textarea({
      rows,
      value: String(cfg[key] ?? ''),
      placeholder,
      onInput: (v) => set(key, v),
    });
    sec.append(ui.field(label, area));
    binders.push({ key, apply: () => { area.value = cfg[key] == null ? '' : String(cfg[key]); } });
  }

  function boolField(sec: HTMLElement, label: string, key: string, hint?: string): void {
    const box = ui.checkbox(label, {
      checked: Boolean(cfg[key]),
      title: hint,
      onChange: (v) => set(key, v),
    });
    sec.append(box.el);
    binders.push({ key, apply: () => box.setChecked(Boolean(cfg[key])) });
  }

  const pickField = (
    sec: HTMLElement,
    label: string,
    key: string,
    options: readonly { value: string; label: string }[],
    hint?: string,
  ): void => {
    const sel = ui.select({
      value: String(cfg[key] ?? ''),
      options,
      onInput: (v) => set(key, v),
    });
    const field = ui.field(label, sel);
    if (hint) field.title = hint;
    sec.append(field);
    binders.push({ key, apply: () => { sel.value = String(cfg[key] ?? ''); } });
  };

  // ── 左列：必回与打赏 ──
  const c1 = ui.section('💰 必回与打赏', '谁花了钱、花了多少，这里定门槛。');
  cols.append(c1);
  numField(c1, '礼物门槛（元）', 'minGiftYuan', '达到这个金额 100% 必回');
  boolField(c1, '游戏道具礼物必回（不看金额）', 'gameGiftAlwaysReply');
  numField(c1, '礼物合并窗口（秒，0 = 不合并）', 'giftMergeSec', '窗口内的多个礼物合成一次回话，省 token');
  numField(c1, '大额礼物门槛（元，0 = 不单列）', 'bigGiftYuan', '达到这个数的礼物单独发一条，不跟小额合并');
  boolField(c1, '小额礼物也接一句（不静默丢）', 'cheapGiftAsChance');
  boolField(c1, '醒目留言 SC 必回', 'replyOnSuperChat');
  numField(c1, 'SC 读完再回（秒）', 'scDelaySec', '0 = 立即回；8 = 先看完');
  boolField(c1, '上舰必回', 'replyOnGuard');
  boolField(c1, '舰长 / 提督 / 总督 进场必欢迎', 'guardWelcome');
  numField(c1, '每人每天最多欢迎几次', 'guardWelcomePerDay', '1 = 每人每天一次；0 = 不限');
  textField(c1, '欢迎词风格提示（可留空）', 'guardWelcomeStyles', '留空 = 每次看现场现编');

  // ── 中列：什么时候开口 ──
  const c2 = ui.section('🎯 什么时候开口', '活跃度和过滤。屏蔽词只挡「主动接话」，点名/礼物/SC 照回。');
  cols.append(c2);

  const burstInput = ui.input({ type: 'number', value: String(cfg['guardBurstSec'] ?? 20), onInput: (v) => set('guardBurstSec', v === '' ? 0 : Number(v)) });
  const sameUserInput = ui.input({ type: 'number', value: String(cfg['sameUserGapSec'] ?? 15), onInput: (v) => set('sameUserGapSec', v === '' ? 0 : Number(v)) });
  const activityRow = pair();
  const gapInput = ui.input({
    type: 'number',
    value: String(cfg.chanceGapSec ?? 50),
    onInput: (v) => set('chanceGapSec', v === '' ? 0 : Number(v)),
  });
  const capInput = ui.input({
    type: 'number',
    value: String(cfg.maxPerHour ?? 80),
    onInput: (v) => set('maxPerHour', v === '' ? 0 : Number(v)),
  });
  const actSel = ui.select({
    value: 'normal',
    options: [
      { value: 'quiet', label: '安静（120 秒一条 / 30 条·时）' },
      { value: 'normal', label: '正常（50 秒一条 / 80 条·时）' },
      { value: 'hot', label: '热闹（25 秒一条 / 150 条·时）' },
    ],
    onInput: (v) => {
      const map: Cfg = {
        quiet: { chanceGapSec: 120, maxPerHour: 30 },
        normal: { chanceGapSec: 50, maxPerHour: 80 },
        hot: { chanceGapSec: 25, maxPerHour: 150 },
      };
      const v2 = map[v] || map.normal;
      set('chanceGapSec', v2.chanceGapSec);
      set('maxPerHour', v2.maxPerHour);
      gapInput.value = String(v2.chanceGapSec);
      capInput.value = String(v2.maxPerHour);
    },
  });
  activityRow.append(ui.field('活跃度（一键切换）', actSel));

  const numRow = pair();
  numRow.append(ui.field('机会型最短间隔（秒）', gapInput), ui.field('每小时上限（条）', capInput));
  c2.append(activityRow, numRow);

  // 独立显眼项：观众荣誉等级门槛（从「高级/连接参数」移出，2026-11-05）
  const gate = numField(c2, '观众荣誉等级门槛（0 = 不限制）', 'minUserLevel',
    '荣誉等级 = 直播间观众等级（弹幕名字旁的灰色数字），送礼涨得快、每日签到也能涨。0 = 不限制；1 = 0 级纯新人小号的弹幕不回应（省 token）。礼物 / SC / 上舰 / 舰长房管不受此门槛。');
  gate.style.borderColor = 'var(--acc, #7c8cff)';
  gate.style.borderWidth = '1px';

  const burstRow = pair();
  burstRow.append(ui.field('房管/舰长连发间隔（秒）', burstInput), ui.field('同一人两条间隔（秒）', sameUserInput));
  c2.append(burstRow);

  boolField(c2, '有人叫她就回（名字 / @）', 'replyOnAt');
  textField(c2, '认这些词算叫她（逗号分隔）', 'atKeywords');
  boolField(c2, '问句也接', 'replyOnQuestion');
  boolField(c2, '过滤噪声（666 / 纯表情 / 刷屏）', 'blockNoise');
  const advD = fold(c2, '屏蔽词与名单（进阶）');
  boolField(advD, '过滤辱骂与赶人', 'blockHostile');
  boolField(advD, '说给别人的不插话', 'blockPeerChat');
  areaField(advD, '屏蔽用户（逗号分隔，模糊匹配）', 'blockUsers', 2, '照抄咩播「屏蔽用户名列表」');
  areaField(advD, '屏蔽词（逗号分隔）', 'blockWords', 3, '照抄咩播「屏蔽敏感词汇」');
  areaField(advD, '额外不友善词（逗号分隔）', 'hostileWords', 2, '内置词表之外再加');
  const advE = fold(c2, '引导话术与游戏指令（进阶）');
  boolField(advE, '穿插引导话术（上舰 / 加群 / 拉红粉）', 'promoCue');
  numField(advE, '两条引导最短间隔（秒）', 'promoGapSec', '默认 600 秒一次，太密像电视购物');
  areaField(advE, '引导话术轮换（一行一条）', 'promoTopics', 3, '按顺序轮着说');
  areaField(advE, '游戏插件指令正则（一行一条）', 'blockPatterns', 4, '猫猫养成：喵 / 左3 / 购买12 …');

  // ── 右列：话怎么送出去 ──
  const c3 = ui.section('📤 话怎么送出去', '气泡 + 直播间弹幕 + QQ 同步。');
  cols.append(c3);
  boolField(c3, '回复同步发到直播间弹幕', 'sendDanmaku');
  boolField(c3, '主人对话也同步到弹幕', 'mirrorUnownedSay');
  const advGuard = fold(c3, '弹幕敏感词（防 B 站屏蔽 / 防泄密）');
  boolField(advGuard, '发弹幕前过滤敏感词', 'danmakuGuard');
  textField(advGuard, '发弹幕时屏蔽的词（逗号分隔）', 'danmakuBlockWords',
    '内置已固定拦三类：金额(数字+元/块/万、打赏、充值、收入、工资、分成)、联系方式(QQ 号、微信号、手机号)、平台敏感词(外挂、脚本、刷量、买粉)。这里只补你想额外拦的；观众说什么不回，去下面「屏蔽词与名单」配。');
  const advA = fold(c3, '弹幕细节（字数 / 间隔 / 颜文字 / 动作）');
  numField(advA, '一条弹幕最多多少字', 'danmakuMaxLen', 'B站直播间实测上限 80');
  numField(advA, '两条弹幕最短间隔（秒）', 'danmakuGapSec', '不够间隔会排队补发');
  boolField(advA, '弹幕里带颜文字', 'emojiInDanmaku');
  numField(advA, '桌宠表情动作频率（每 N 条 1 次）', 'petActionRate', '2 = 每两条带一次；0 = 不做');
  numField(c1, '舰长每天可画几张（0 = 不限）', 'guardDrawPerDay', '用完后她会约明天，不调画图工具');
  numField(c3, '回应字数上限', 'replyMaxChars', '写进提示词，建议 30~50');
  boolField(c3, '普通观众进场也招呼一声', 'sendEnter');
  numField(c3, '进场欢迎的粉丝牌门槛', 'enterMedalLevel', '0 = 不看牌子');
  boolField(c3, '把回应转发到 QQ', 'forwardToQq');
  textField(c3, 'QQ 目标（群号 / u:私聊号）', 'qqForwardTargets');
  pickField(c3, '转发格式', 'qqForwardFormat', [
    { value: 'important', label: '只转 @她 / 礼物 / SC（推荐）' },
    { value: 'full', label: '带观众原话' },
    { value: 'reply', label: '只转她的回应' },
  ]);
  const advB = fold(c3, '转发限速 · 现场速报（进阶，一般不用改）');
  numField(advB, '同一个人转发间隔（秒）', 'qqForwardGapSec', '同一人 60 秒内只转一条；不同人互不影响');
  boolField(advB, '节流按人算（不同观众互不挤占）', 'qqForwardPerUser');
  numField(advB, '两条转发最小间隔（秒）', 'qqForwardMinGapSec', '防瞬间连发；0 = 不限');
  numField(advB, '每分钟最多转发几条', 'qqForwardMaxPerMin', '超出的这条直接丢，日志写原因；0 = 不限');
  numField(advB, '现场速报间隔（秒，0 = 关）', 'qqDigestSec', '直播中每 N 秒发一条「在线人数 + 刚发生什么 + 她的原话 + 入口」');
  const advC = fold(c3, '开播 / 下播播报（进阶）');
  boolField(advC, '开播 / 下播自动在群里播报', 'autoLiveNotice');
  textField(advC, '播报发到哪（群号 / u:QQ）', 'liveNoticeTarget');
  numField(advC, '两条播报最短间隔（秒）', 'liveNoticeGapSec');
  numField(advC, '每天最多播报几条', 'liveNoticeMaxPerDay');

  const noticeRow = ui.rowbar();
  const btnPreview = ui.button('预览播报指令', {
    size: 'sm',
    onClick: () => {
      void (async () => {
        try {
          const r = (await ctx.invoke('noticePreview')) as { start: string; stop: string; todayCount: number; cap: number };
          msg.info(`今天已发 ${r.todayCount}/${r.cap} 条`);
          ui.drawer('播报指令预览', `${r.start}\n\n──────────\n\n${r.stop}`);
        } catch (e) {
          msg.error(`预览失败：${String(e).slice(0, 90)}`);
        }
      })();
    },
  });
  const btnTest = ui.button('试发一条开播', {
    size: 'sm',
    onClick: () => {
      void (async () => {
        const ok = await ui.confirm({ title: '现在真的发一条开播通知？', body: '会按上面「播报发到哪」的目标发送。' });
        if (!ok) return;
        try {
          await ctx.invoke('noticeTest', ['start']);
          msg.info('已让 agent 去发，几秒后看群');
        } catch (e) {
          msg.error(`试发失败：${String(e).slice(0, 90)}`);
        }
      })();
    },
  });
  noticeRow.append(btnPreview, btnTest);
  c3.append(noticeRow);

  // 整宽：本场玩法（开播前改这一块，改完她每条提示词都带着）
  const top = ui.section('🎮 本局游戏（换游戏只改这一块）', '道具表一行一条「阵营|礼物|效果」，红粉=帮主播、黑粉=整蛊。换游戏整块替换，旧内容不留痕。');
  colsTop.append(top);
  textField(top, '游戏名', 'gameName', '例：小孩过马路 1.1');
  areaField(top, '玩法简介（写两三句）', 'gameBrief', 3, '例：把小孩从右边送到左边，被车撞就掉；左上角清零才能下播');
  areaField(top, '道具表（阵营|礼物|效果）', 'gameItems', 8, '红粉|粉丝团灯牌|路障+加速跑10秒');
  areaField(top, '规则与术语（一行一条）', 'gameRules', 5, '暴击：长按 10/100/520 个，每 10 个转一次盘，倍率 1~5');

  // ── 底部：高级 ──
  const adv = document.createElement('details');
  adv.style.cssText = 'margin-top:16px;';
  const sum = document.createElement('summary');
  sum.textContent = '高级 / 连接参数（平时不用动）';
  sum.style.cssText = 'cursor:pointer;opacity:.75;font-size:13px;padding:6px 0;';
  adv.append(sum);
  const advGrid = grid('repeat(auto-fit, minmax(260px, 1fr))');
  advGrid.style.marginTop = '10px';
  adv.append(advGrid);
  sheet.body.append(adv);

  const a1 = ui.section('连接');
  const a2 = ui.section('底层开关');
  advGrid.append(a1, a2);
  textField(a1, '弹幕来源地址', 'streamUrl', '改完要重启 World');
  numField(a1, '发弹幕的直播间号', 'danmakuRoomId');
  textField(a1, 'bili_jct', 'danmakuBiliJct');
  textField(a1, 'Cookie（留空则复用 B站插件）', 'danmakuCookie');
  boolField(a2, '从事件库读礼物/SC/上舰（必须开）', 'useStoreEvents');
  numField(a2, '总限频（秒，0 = 不启用）', 'gapSec', '最低优先级的「每 X 分钟一条」总闸');
  textField(a2, '她自己的昵称（防自回声）', 'selfNames');
  boolField(a2, '人气/榜单也推给模型', 'sendAudience');

  // 初始加载：按标签把真实值塞回控件（原语没暴露 id，只能按 label 认）
  void (async () => {
    try {
      cfg = (await ctx.invoke('load')) as Cfg;
      // 主路径：按字段名逐个回填（不受标签措辞影响）
      for (const b of binders) {
        try { b.apply(); } catch { /* 单个控件坏了不影响其他 */ }
      }
      // 兜底：没登记过的（老写法）仍按标签文字匹配
      for (const el of Array.from(sheet.body.querySelectorAll('input, textarea, select'))) {
        const node = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        const labelEl = node.closest('label');
        const text = (labelEl?.textContent || '').replace(/：$/, '').trim();
        const hit = KEYS.find((k) => text.startsWith(k.label));
        if (!hit) continue;
        const v = cfg[hit.field];
        if (node instanceof HTMLInputElement && node.type === 'checkbox') node.checked = Boolean(v);
        else if (v !== undefined && v !== null && v !== '') node.value = String(v);
      }
      msg.info('已读取当前配置');
    } catch (e) {
      msg.error(`读取配置失败：${String(e).slice(0, 90)}`);
    }
  })();
}

/** 标签 → 配置键，回填时按标签文字匹配 */
const KEYS: Array<{ label: string; field: string }> = [
  { label: '礼物门槛（元）', field: 'minGiftYuan' },
  { label: '小额礼物也接一句', field: 'cheapGiftAsChance' },
  { label: '醒目留言 SC 必回', field: 'replyOnSuperChat' },
  { label: 'SC 读完再回（秒）', field: 'scDelaySec' },
  { label: '上舰必回', field: 'replyOnGuard' },
  { label: '舰长 / 提督 / 总督 进场必欢迎', field: 'guardWelcome' },
  { label: '每人每天最多欢迎几次', field: 'guardWelcomePerDay' },
  { label: '欢迎词风格提示（可留空）', field: 'guardWelcomeStyles' },
  { label: '机会型最短间隔（秒）', field: 'chanceGapSec' },
  { label: '每小时上限（条）', field: 'maxPerHour' },
  { label: '有人叫她就回（名字 / @）', field: 'replyOnAt' },
  { label: '认这些词算叫她（逗号分隔）', field: 'atKeywords' },
  { label: '问句也接', field: 'replyOnQuestion' },
  { label: '过滤噪声（666 / 纯表情 / 刷屏）', field: 'blockNoise' },
  { label: '过滤辱骂与赶人', field: 'blockHostile' },
  { label: '说给别人的不插话', field: 'blockPeerChat' },
  { label: '屏蔽用户（逗号分隔，模糊匹配）', field: 'blockUsers' },
  { label: '屏蔽词（逗号分隔）', field: 'blockWords' },
  { label: '额外不友善词（逗号分隔）', field: 'hostileWords' },
  { label: '回复同步发到直播间弹幕', field: 'sendDanmaku' },
  { label: '一条弹幕最多多少字', field: 'danmakuMaxLen' },
  { label: '两条弹幕最短间隔（秒）', field: 'danmakuGapSec' },
  { label: '回应字数上限', field: 'replyMaxChars' },
  { label: '普通观众进场也招呼一声', field: 'sendEnter' },
  { label: '进场欢迎的粉丝牌门槛', field: 'enterMedalLevel' },
  { label: '把回应转发到 QQ', field: 'forwardToQq' },
  { label: 'QQ 目标（群号 / u:私聊号）', field: 'qqForwardTargets' },
  { label: '转发格式', field: 'qqForwardFormat' },
  { label: '同一个人转发间隔（秒）', field: 'qqForwardGapSec' },
  { label: '节流按人算', field: 'qqForwardPerUser' },
  { label: '两条转发最小间隔（秒）', field: 'qqForwardMinGapSec' },
  { label: '每分钟最多转发几条', field: 'qqForwardMaxPerMin' },
  { label: '现场速报间隔（秒）', field: 'qqDigestSec' },
  { label: '弹幕来源地址', field: 'streamUrl' },
  { label: '发弹幕的直播间号', field: 'danmakuRoomId' },
  { label: 'bili_jct', field: 'danmakuBiliJct' },
  { label: 'Cookie（留空则复用 B站插件）', field: 'danmakuCookie' },
  { label: '从事件库读礼物/SC/上舰（必须开）', field: 'useStoreEvents' },
  { label: '总限频（秒，0 = 不启用）', field: 'gapSec' },
  { label: '观众荣誉等级门槛（0 = 不限制）', field: 'minUserLevel' },
  { label: '她自己的昵称（防自回声）', field: 'selfNames' },
  { label: '人气/榜单也推给模型', field: 'sendAudience' },
  { label: '玩法简介（写两三句）', field: 'gameBrief' },
  { label: '游戏名', field: 'gameName' },
  { label: '道具表（阵营|礼物|效果）', field: 'gameItems' },
  { label: '规则与术语（一行一条）', field: 'gameRules' },
  { label: '开播 / 下播自动在群里播报', field: 'autoLiveNotice' },
  { label: '播报发到哪（群号 / u:QQ）', field: 'liveNoticeTarget' },
  { label: '两条播报最短间隔（秒）', field: 'liveNoticeGapSec' },
  { label: '每天最多播报几条', field: 'liveNoticeMaxPerDay' },
  { label: '穿插引导话术', field: 'promoCue' },
  { label: '两条引导最短间隔（秒）', field: 'promoGapSec' },
  { label: '引导话术轮换（一行一条）', field: 'promoTopics' },
  { label: '游戏插件指令正则（一行一条）', field: 'blockPatterns' },
  { label: '游戏道具礼物必回（不看金额）', field: 'gameGiftAlwaysReply' },
  { label: '房管/舰长连发间隔（秒）', field: 'guardBurstSec' },
  { label: '同一人两条间隔（秒）', field: 'sameUserGapSec' },
  { label: '弹幕里带 B站表情 / 颜文字', field: 'emojiInDanmaku' },
  { label: '礼物合并窗口（秒）', field: 'giftMergeSec' },
  { label: '大额礼物门槛（元）', field: 'bigGiftYuan' },
  { label: '桌宠表情动作频率（每 N 条 1 次）', field: 'petActionRate' },
  { label: '舰长每天可画几张（0 = 不限）', field: 'guardDrawPerDay' },
];

// ───────────────────────────────────────────────
// QQ 同步气泡
// ───────────────────────────────────────────────

function mountQqSync(ctx: WebUiPanelContext): void {
  const ui = ctx.ui;

  const sheet = ui.sheet({
    title: 'QQ 同步气泡',
    desc: '她发往 QQ 的每一条消息（群聊、私聊都算），都会在这里逐条记录一次（去重，最多 100 条）。',
  });
  ctx.root.append(sheet.el);

  const seg = ui.segmented(
    [
      { value: 'on', label: '开启' },
      { value: 'off', label: '关闭' },
    ],
    {
      value: 'on',
      onSelect: (v) => {
        void (async () => {
          try {
            await ctx.invoke('setEnabled', [v === 'on']);
            await refresh();
          } catch (e) {
            msg.error(`保存失败：${String(e).slice(0, 80)}`);
          }
        })();
      },
    },
  );

  const rowbar = ui.rowbar();
  const btnRefresh = ui.button('刷新', { size: 'sm', onClick: () => void refresh() });
  const btnClear = ui.button('清空记录', {
    size: 'sm',
    onClick: () => {
      void (async () => {
        try {
          await ctx.invoke('clear');
          await refresh();
          msg.info('已清空');
        } catch (e) {
          msg.error(`清空失败：${String(e).slice(0, 80)}`);
        }
      })();
    },
  });
  rowbar.append(btnRefresh, btnClear);

  const msg = ui.msgline();
  const table = ui.table({ head: ['时间', '渠道', '内容'], maxHeight: 'calc(100vh - 420px)' });
  sheet.body.append(seg.el, rowbar, msg, table.el);

  async function refresh(): Promise<void> {
    try {
      const data = (await ctx.invoke('list')) as ListResult;
      try {
        seg.setValue?.(data.enabled ? 'on' : 'off');
      } catch {
        /* 老版本没有 setValue */
      }
      if (!data.items.length) {
        table.clear('还没有记录。等她在群里说话后，这里会出现条目。');
        msg.info(data.enabled ? '同步已开启' : '同步已关闭');
        return;
      }
      table.clear();
      for (const it of data.items.slice().reverse()) {
        table.addRow([
          it.ts,
          { text: it.kind === 'group' ? '群' : '私聊', cls: 'mono' },
          { text: it.text, cls: 'txt' },
        ]);
      }
      msg.info(`${data.enabled ? '同步已开启' : '同步已关闭'} · 共 ${data.count} 条`);
    } catch (e) {
      msg.error(`读取失败：${String(e).slice(0, 100)}`);
    }
  }

  void refresh();
  ctx.interval(() => void refresh(), 5000);
}

// ───────────────────────────────────────────────
// 现场实况
// ───────────────────────────────────────────────

interface StatsResult {
  running: boolean;
  store: string;
  counters: { must: number; chance: number; skipped: number };
  skips: Record<string, number>;
  recentReplies: string[];
  decisions: Array<{ ts: string; kind: string; user: string; body: string; action: string; reason: string }>;
}

function mountLiveStats(ctx: WebUiPanelContext): void {
  const ui = ctx.ui;
  const sheet = ui.sheet({
    title: '现场实况',
    desc: '为什么回、为什么不回，全在这里。开播时盯着「跳过原因」就能判断是不是过滤太狠。',
  });
  ctx.root.append(sheet.el);

  const msg = ui.msgline();
  const stats = ui.statgrid([]);
  const skipLine = ui.msgline();
  const rowbar = ui.rowbar();
  rowbar.append(ui.button('刷新', { size: 'sm', onClick: () => void refresh() }));
  const table = ui.table({
    head: ['时间', '类型', '观众', '内容', '处理', '原因'],
    maxHeight: '420px',
  });
  sheet.body.append(stats, msg, skipLine, rowbar, table.el);

  async function refresh(): Promise<void> {
    try {
      const d = (await ctx.invoke('list')) as StatsResult;
      stats.replaceChildren(
        ui.stat({ k: '必回', v: String(d.counters.must) }),
        ui.stat({ k: '机会型', v: String(d.counters.chance) }),
        ui.stat({ k: '过滤', v: String(d.counters.skipped) }),
        ui.stat({ k: '事件库', v: String(d.store).includes('已接入') ? '已接入' : '未接入' }),
      );
      const skips = Object.entries(d.skips || {}).sort((a, b) => b[1] - a[1]).slice(0, 6);
      skipLine.info(skips.length ? `跳过原因：${skips.map(([k, v]) => `${k} ${v}`).join(' · ')}` : '还没有跳过记录');
      // 空状态不能用 table.clear('文字')：本版宿主把空状态渲染成空行，看起来就是白板
      if (!d.decisions.length) {
        table.clear();
        table.addRow([
          '—', '—', '—',
          { text: '还没有判定记录。开播后这里会逐条出现（收到弹幕 1 秒内就有）。', cls: 'txt' },
          '—', '—',
        ]);
        msg.info(`还没收到弹幕 · 计数：必回 ${d.counters.must} / 机会 ${d.counters.chance} / 过滤 ${d.counters.skipped}`);
        return;
      }
      table.clear();
      const rows = d.decisions.slice().reverse();
      for (const it of rows) {
        table.addRow([
          String(it.ts ?? ''),
          String(it.kind ?? ''),
          String(it.user ?? ''),
          { text: String(it.body || '—'), cls: 'txt' },
          String(it.action ?? ''),
          { text: String(it.reason ?? ''), cls: 'mono' },
        ]);
      }
      // 兜底：万一表格样式被压成 0 高（小窗口/主题差异），至少把最近几条用文字列出来
      if (!table.body.children.length && rows.length) {
        msg.error(`表格渲染异常，最近 ${Math.min(5, rows.length)} 条：` +
          rows.slice(0, 5).map((r) => `${r.ts} ${r.action} ${r.reason}`).join(' ｜ '));
        return;
      }
      msg.info(`最近 ${d.decisions.length} 条判定 · 她最近说过：${(d.recentReplies || []).slice(-2).join(' / ') || '—'}`);
    } catch (e) {
      msg.error(`读取失败：${String(e).slice(0, 100)}`);
    }
  }

  void refresh();
  ctx.interval(() => void refresh(), 4000);
}


// ───────────────────────────────────────────────
// 直播画面（Overlay）
// ───────────────────────────────────────────────

/** 把 B站插件的 overlay 页嵌进来：预览 / 打开编辑器 / 复制 OBS 地址。 */
function mountOverlay(ctx: WebUiPanelContext): void {
  const ui = ctx.ui;
  const sheet = ui.sheet({
    title: '直播画面（Overlay）',
    desc: '这里是「拿地址 + 打开看」的地方，不是必须内嵌预览。没弹幕/礼物时画面本来就空，属正常。',
  });
  ctx.root.append(sheet.el);

  const msg = ui.msgline();
  const bar = ui.rowbar();
  const stage = document.createElement('div');
  stage.style.cssText =
    'margin-top:10px;border:1px dashed rgba(255,255,255,.18);border-radius:10px;' +
    'padding:22px 18px;line-height:1.9;font-size:13px;color:#c9cfda;background:rgba(255,255,255,.02)';

  const info = { overlayUrl: '', previewUrl: '', editorUrl: '' };
  let frameMounted = false;

  /** 默认视图：地址 + 怎么用。不做内嵌，省得对着白板猜。 */
  const showCard = (): void => {
    stage.replaceChildren();
    const h = document.createElement('div');
    h.style.cssText = 'font-size:14px;font-weight:600;color:#e6e8eb;margin-bottom:8px';
    h.textContent = 'OBS 地址（填进「浏览器」源，1920×1080，勾选透明）';
    const url = document.createElement('div');
    url.textContent = info.overlayUrl || '（还没读到地址）';
    url.style.cssText =
      'font-family:ui-monospace,Consolas,monospace;font-size:13px;padding:9px 11px;' +
      'border-radius:8px;background:rgba(0,0,0,.35);word-break:break-all;margin-bottom:12px';
    const tip = document.createElement('div');
    tip.style.cssText = 'color:#9aa3b2;font-size:12.5px';
    tip.innerHTML =
      '· <b>想在 Coo 里看</b>：点「在浏览器打开」——会用系统浏览器打开棋盘格预览，一定能看到。<br>' +
      '· <b>画面是空白</b>：说明这一刻没有弹幕/礼物进来，属正常，不是坏了。<br>' +
      '· <b>想在面板里内嵌</b>：可以点「仍然内嵌试试」，但部分安全策略会拦，白屏就是那个原因。';
    stage.append(h, url, tip);
  };

  const mountFrame = async (): Promise<void> => {
    const src = info.previewUrl || info.overlayUrl;
    if (!src) return;
    frameMounted = true;
    stage.replaceChildren();
    // 先探一次：探不通直接告诉用户，不要挂个白框
    try {
      await fetch(src, { mode: 'no-cors', cache: 'no-store' });
    } catch {
      msg.error('内嵌通道被系统策略拦了（页面本身没坏）。用「在浏览器打开」即可。');
      frameMounted = false;
      showCard();
      return;
    }
    const frame = document.createElement('iframe');
    frame.style.width = '100%';
    frame.style.height = 'calc(100vh - 360px)';
    frame.style.minHeight = '280px';
    frame.style.border = '0';
    frame.style.borderRadius = '10px';
    frame.style.background = 'rgba(0,0,0,.35)';
    frame.src = src;
    stage.append(frame);
    msg.info('已尝试内嵌。若仍是白板，说明被拦了——点「在浏览器打开」就行。');
  };

  const openInBrowser = (): void => {
    const url = info.previewUrl || info.overlayUrl;
    if (url) window.open(url, '_blank');
  };

  bar.append(
    ui.button('在浏览器打开', { size: 'sm', variant: 'primary', onClick: openInBrowser }),
    ui.button('打开编辑器', {
      size: 'sm',
      onClick: () => {
        const url = info.editorUrl || info.overlayUrl;
        if (url) window.open(url, '_blank');
      },
    }),
    ui.button('复制 OBS 地址', {
      size: 'sm',
      onClick: () => {
        if (!info.overlayUrl) return;
        navigator.clipboard
          ?.writeText(info.overlayUrl)
          .then(() => msg.info(`已复制：${info.overlayUrl}`))
          .catch(() => msg.error(`复制失败，手动复制：${info.overlayUrl}`));
      },
    }),
    ui.button('仍然内嵌试试', { size: 'sm', onClick: () => void mountFrame() }),
  );
  sheet.body.append(bar, msg, stage);

  const load = async (): Promise<void> => {
    try {
      const d = (await Promise.race([
        ctx.invoke('info'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('读取地址超时（5 秒）')), 5000)),
      ])) as { overlayUrl?: string; previewUrl?: string; editorUrl?: string };
      info.overlayUrl = String(d?.overlayUrl || '');
      info.previewUrl = String(d?.previewUrl || '');
      info.editorUrl = String(d?.editorUrl || '');
      msg.info(`地址已就绪 · 点「在浏览器打开」看预览`);
      if (!frameMounted) showCard();
    } catch (e) {
      msg.error(`读取失败：${String(e).slice(0, 90)}`);
      showCard();
    }
  };
  void load();
}

const bundle: WebUiClientBundle = {
  panels: {
    settings: { mount: mountSettings },
    'qq-sync': { mount: mountQqSync },
    overlay: { mount: mountOverlay },
    'live-stats': { mount: mountLiveStats },
  },
};

export default bundle;
