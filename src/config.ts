/**
 * 配置组：让 Coopanion 的 WebUI 自动生成「直播弹幕桥」的配置面板。
 *
 * 结构照抄 cortico-world-bilibili/src/config.ts（MIT, Pal AI Lab）：
 * 一个 *_DEFAULTS 对象 + 一个返回 ConfigGroup 的函数，schema 用 JSON Schema，
 * properties 的 key 是完整配置路径 worlds.live-cue.*。
 */
import type { ConfigGroup } from 'cortico/core/types.ts';

export const LIVE_CUE_DEFAULTS = {
  /** 由装配层显式开启 */
  enabled: false,
  /** 7795 SSE 地址 */
  streamUrl: 'http://127.0.0.1:7795/stream',
  /** 从 B站插件的事件库补全礼物/SC/上舰（overlay 流不带礼物金额，必须走这条） */
  useStoreEvents: true,
  /** 两次唤醒最短间隔（秒）；0 = 关闭限频（必回项本来就不受限） */
  gapSec: 0,
  /** 礼物金额门槛（元） */
  minGiftYuan: 1,
  /** 大额礼物：单独转发一条，不跟小额合并 */
  bigGiftYuan: 10,
  gameGiftAlwaysReply: false,
  guardBurstSec: 15,
  sameUserGapSec: 10,
  emojiInDanmaku: true,
  replyEmoteOnly: false,
  /** 礼物合并窗口（秒）：窗口内的多个礼物合成一次模型调用；0 = 每条礼物各叫一次 */
  giftMergeSec: 8,
  /** 每几条回复带一次桌宠表情/动作；0 = 不带 */
  petActionRate: 2,
  /** 舰长每天可免费出图几张；0 = 不限 */
  guardDrawPerDay: 1,
  /** 舰长本月首次上舰，自动画一张祝贺图并�发粉丝群 */
  guardPortrait: true,
  /** 祝贺画/重要事请示的主人 QQ（私聊确认用） */
  portraitOwner: '',
  /** 低于门槛的礼物按「机会型」处理（true）还是一律不理（false） */
  cheapGiftAsChance: true,
  /** 弹幕 @ 了她/主播时回应 */
  replyOnAt: true,
  /** 弹幕含问句时回应 */
  replyOnQuestion: true,
  /** 回应醒目留言（SC） */
  replyOnSuperChat: true,
  /** 回上舰 */
  replyOnGuard: true,
  /** SC 读完再回的等待秒数（0 = 立即回） */
  scDelaySec: 8,
  /** 统一噪声过滤：刷屏 / 纯数字 / 纯表情 */
  blockNoise: true,
  /** 舰长与管理员优先回复（只影响节流排队，不跳过过滤） */
  prioritizeGuard: true,
  /** 礼物必回总开关（达到金额门槛 100% 必回） */
  replyOnGift: true,
  /** 过滤不友善 / 辱骂 / 赶人的弹幕 */
  blockHostile: true,
  /** 额外的不友善词（逗号分隔） */
  hostileWords: '',
  /** 屏蔽词：照抄咩播（命中只挡机会型插话，点名/礼物/SC/上舰照回） */
  blockWords: '',
  /** 过滤「说给主播或别的观众」的对话弹幕（没点名她就不插话） */
  blockPeerChat: true,
  /** 屏蔽名单：这些用户名发什么都不理（逗号分隔，支持模糊包含） */
  blockUsers: '',
  /** 她自己的昵称（防自回声） */
  selfNames: '然家小鲸鱼',
  /** 猫猫养成等游戏插件的指令：命中直接丢，别进模型 */
  blockPatterns: [
    '^(喵|修炼|查询|背包|钓鱼|贴贴|舔一口|入场特效|喵喵券|回家吃饭|召唤宠物|召唤喵娘)$',
    '^(购买|使用|买入|卖出|召唤|发神金|滚月饼)\\S{0,6}$',
    '^[左右][1-9]$',
    '^(爬屏幕|猫猫冲撞)',
  ].join('\n'),
  /** 本场玩法，开播前填 */
  gameBrief: '',
  /** 游戏包 */
  gamePackId: 'crossing',
  gameName: '小孩过马路 1.1',
  /** 道具表：阵营|礼物|效果（红粉帮主播，黑粉整蛊） */
  gameItems: [
    '红粉|粉丝团灯牌|路障+加速跑10秒',
    '红粉|毛线球|烧毁无人机',
    '红粉|甜滋滋|车道-5',
    '红粉|情书|挖机护航小孩到终点',
    '红粉|水晶鞋|减车道（数量随机）',
    '红粉|喜欢你|保护盾+解控1K',
    '红粉|做我的小猫|永久路障+超加速',
    '红粉|告白花束|正义高铁（数量随机）',
    '黑粉|人气票|随机增减小孩',
    '黑粉|待补|直升机',
    '黑粉|待补|动感光波×2',
    '黑粉|待补|加车道×N',
    '黑粉|待补|全图飞×3',
    '黑粉|待补|加小孩×N',
    '黑粉|待补|推机：小孩推回起点',
    '黑粉|待补|全图转盘×N',
    '黑粉|待补|硬控主播+破盾1K',
    '黑粉|待补|关闭路障+减速',
    '黑粉|待补|邪恶高铁×N',
    '黑粉|待补|全屏轰炸',
  ].join('\n'),
  gameRules: [
    '目标：把小孩从右侧起点护送穿过斑马线到最左侧终点，别被后方车辆撞飞。',
    '下播：左上角剩余小孩清零才能下班。',
    '惩罚：被连击累计每 10001 就叠 5 个铁盆惩罚。',
    '暴击：长按礼物可选 10 / 100 / 520 个；每 10 个抽一次转盘，倍率 1~5 倍；有概率触发暴击进化，把当前道具升级成更贵的形态（如香蕉皮→全屏轰炸）。',
    '车道机制：车道 +1 对主播更险，车道 -1 更安全；路障可让当前车道 15 秒不通车，时间可叠加。',
    '术语：嘎 = 小孩被撞掉；小海 = 小孩；喀秋莎 = 全屏轰炸暴击；关猫 = 关掉猫猫养成玩法（不是关猫）。',
  ].join('\n'),
  /** 开播/下播自动播报 */
  autoLiveNotice: true,
  liveNoticeGapSec: 1800,
  liveNoticeMaxPerDay: 6,
  noticeStickerDelaySec: 60,
  livePostDynamic: false,
  /** 开播时把「前一天战报」发到 B站动态，只发一次（默认关，确认文案后再开） */
  reportDynamic: false,
  ownerUids: '',
  ownerNames: '然酱丶重生版',
  rankRuid: 0,
  liveNoticeTarget: '',
  /** 陪播引导 */
  promoCue: true,
  promoGapSec: 600,
  promoTopics: [
    '上舰：提一句舰长有专属待遇（点节目、整蛊特权、名字上墙），别硬推销',
    '加群：提一句粉丝群能点节目、能提前知道开播（群号在配置里），别硬推销',
    '拉红粉：问一句站红粉还是黑粉，红粉是帮主播过关的自己人',
    '劝别捣乱：黑粉是玩法，别骂人、别带节奏',
  ].join('\n'),
  /** 机会型回应总开关：没点名她的问句 / 有内容的闲聊，偶尔接一句 */
  chanceReply: true,
  /** 机会型回应最短间隔（秒）；0 = 关闭机会型回应 */
  chanceGapSec: 35,
  /** 观众荣誉等级门槛：低于此等级的弹幕不回应（0 = 不限制）。荣誉等级=直播间观众等级，主要靠送礼/签到涨 */
  minUserLevel: 1,
  /** 把发往 QQ 群的消息同步记录到气泡面板 */
  syncQqToBubble: true,
  /** 把对直播弹幕的回应转发到 QQ（0 token） */
  forwardToQq: false,
  /** 转发目标：群号或私聊 QQ 号，多个用英文逗号分隔 */
  qqForwardTargets: '',
  /** 转发格式：reply=只发她的回应 / full=带弹幕来源 / important=只转重要的 */
  qqForwardFormat: 'important',
  /** 转发节流（秒）：**同一个人**两次转发之间至少隔这么久（2026-11-11 改为按人计算） */
  qqForwardGapSec: 60,
  /** true = 节流按人算（不同人互不影响）；false = 退回旧的全局间隔 */
  qqForwardPerUser: true,
  /** 任意两条转发之间的最小间隔（秒），0 = 不限制 */
  qqForwardMinGapSec: 5,
  /** 每分钟最多转发几条，0 = 不限制 */
  qqForwardMaxPerMin: 6,
  /** 现场速报间隔（秒）：0 = 关闭；直播中每 N 秒发一条「直播间正在发生什么」 */
  qqDigestSec: 1800,
  /** 把回复同步发到 B 站直播间弹幕（与气泡共用同一段文字，0 额外 token） */
  sendDanmaku: true,
  mirrorUnownedSay: true,
  danmakuGuard: true,
  danmakuBlockWords: '',
  /** 发弹幕用的 Cookie（需含 SESSDATA 与 bili_jct） */
  danmakuCookie: '',
  /** 发弹幕的直播间号（真实房间号） */
  danmakuRoomId: 0,
  /** 弹幕最大宽度（B站按「半角字符位」算：中文 2、英文/数字 1，上限 80） */
  danmakuMaxLen: 80,
  /** 两条弹幕最短间隔（秒） */
  danmakuGapSec: 8,
  /** 发给模型的回应字数上限（发弹幕时自动按 danmakuMaxLen 收） */
  replyMaxChars: 40,
  /** 每小时最多推给模型多少条（0 = 不限） */
  maxPerHour: 90,
  /** 被@/喊名字时认哪些词（逗号分隔） */
  atKeywords: '鱼宝,小鲸鱼,小金鱼,鲸鱼,然家小鲸鱼,然酱,然哥,主播',
  /** 有人进场时要不要欢迎 */
  sendEnter: true,
  /** 只欢迎粉丝牌等级达到此值的进场（0 = 不限） */
  enterMedalLevel: 1,
  /** 舰长 / 提督 / 总督 进场必欢迎（带仪式感，每人每天限次） */
  guardWelcome: true,
  /** 每人每天最多欢迎几次（1 = 每天一次，0 = 不限） */
  guardWelcomePerDay: 1,
  guardWelcomeMaxPerDay: 100,
  /** 欢迎词参考风格（留空 = 完全自由发挥，按现场实时生成） */
  guardWelcomeStyles: '',
  /** 人气/榜单等统计事件是否也推给模型 */
  sendAudience: false,
  /** 发弹幕用的 bili_jct（SESSDATA 会自动复用 B站插件里的） */
  danmakuBiliJct: '',
};

type Lang = 'zh' | 'en';

const T = {
  zh: {
    title: '直播弹幕桥',
    desc: '把 B站直播间弹幕桥接成一次常规唤醒，让桌宠用对话气泡回应观众。',
    streamUrl: { t: '弹幕来源地址', d: '默认指向本机 7795（B站直播间插件的 SSE）。改这里只在你要换数据源时才需要。' },
    gapSec: { t: '两条回复的最短间隔（秒）', d: '只管「机会型」回应；必回项（叫她、礼物、SC、上舰）不受它限制。0 = 完全不启用这条限频。' },
    bigGiftYuan: { t: '大额礼物门槛（元）', d: '达到这个数的礼物单独发一条（不跟小额礼物合并），让群里一眼看到。默认 10 元；0 = 不单列。' },
    minGiftYuan: { t: '礼物金额门槛（元）', d: '达到这个数就 100% 必回；低于门槛的小礼物按下面的开关处理。金额来自 B站插件事件库，是真实成交价。' },
    replyOnAt: { t: '有人 @ 她时回应', d: '弹幕里出现「@鱼宝」「小鲸鱼」「然哥」「主播」等词时优先回应。' },
    replyOnQuestion: { t: '问到问题时回应', d: '含问号、吗、呢、怎么、什么、几点、多少、谁 的弹幕会回应。' },
    replyOnSuperChat: { t: '醒目留言（SC）必回', d: 'SC 是花钱买的位置，建议一直开着。' },
    replyOnGuard: { t: '上舰必回', d: '舰长/提督/总督开通时回应，建议一直开着。' },
    blockNoise: { t: '过滤噪声弹幕', d: '开着时同时过滤三类：刷屏（同一字符连刷/超长）、纯数字（666/233）、纯表情（只有 emoji 或符号）。' },
    prioritizeGuard: { t: '舰长与管理员优先回复', d: '开着时，舰长（舰长/提督/总督）和管理员的弹幕在排队时优先处理（不受节流间隔限制），但照样要通过上面的噪声过滤和等级门槛。' },
    forwardToQq: { t: '把弹幕回应转发到 QQ', d: '开着时，她对直播弹幕的每一次回应都会转发到你指定的群或私聊。不消耗额外 token。' },
    qqForwardTargets: { t: '转发目标（群号 / QQ 号）', d: '填群号（如 123456789）或私聊 QQ 号（前面加 u:，如 u:10001）；多个用英文逗号分隔。' },
    qqForwardFormat: { t: '转发格式', d: 'reply = 只发她的回应；full = 带上观众原话（推荐）；important = 只转 @她/礼物/SC。直播时建议 important，群里不会被刷屏。' },
    qqForwardGapSec: { t: '同一个人转发间隔（秒）', d: '同一个人在群里被转发的两条之间至少隔这么久。默认 60 秒；不同的人互不影响（2026-11-11 改）。' },
    qqForwardPerUser: { t: '节流按人算', d: '开着：不同观众各算各的，A 刚被转过不影响 B（推荐）。关掉：退回旧的全局 60 秒，第二个人的消息会被丢掉。' },
    qqForwardMinGapSec: { t: '两条之间最小间隔（秒）', d: '不管是谁，任意两条转发之间至少隔这么久，防止一瞬间连发好几条。默认 5 秒，0 = 不限。' },
    qqForwardMaxPerMin: { t: '每分钟最多转发几条', d: '一分钟内最多往群里发几条转发，超出的这条直接丢（日志里会写）。默认 6，0 = 不限。' },
    qqDigestSec: { t: '现场速报间隔（秒）', d: '没进直播间的粉丝看不到里面在干嘛。开着时，直播中每 N 秒发一条「在线多少人 + 刚才发生了什么 + 直播间入口」。默认 1800 = 30 分钟；0 = 关闭。' },
    minUserLevel: { t: '观众直播间等级门槛（UL / 荣耀等级）', d: '读的是弹幕里的 info[4][0]，官方文档叫 glory_level（直播荣耀等级），弹幕名字旁那个灰色数字，签到和送礼都能涨。0 = 不限制；1 = 等级 0 的新号弹幕不回，省 token。不受门槛限制的：舰长 / 房管 / 戴粉丝灯牌的老粉 / 本场送过任何礼物的人。礼物、SC、上舰本身也照回。' },
  },
  en: {
    title: 'Live Danmaku Bridge',
    desc: 'Bridge Bilibili live-room danmaku into a regular wake-up so the pet replies with a speech bubble.',
    streamUrl: { t: 'Danmaku source URL', d: 'Defaults to local port 7795 (the Bilibili live extension SSE).' },
    gapSec: { t: 'Min seconds between occasional replies', d: 'Only applies to occasional replies; must-reply items are never throttled. 0 = off.' },
    bigGiftYuan: { t: 'Big gift threshold (CNY)', d: 'Gifts at or above this amount are forwarded as their own message.' },
    minGiftYuan: { t: 'Gift threshold (CNY)', d: 'Gifts at or above this amount always get a reply.' },
    replyOnAt: { t: 'Reply when mentioned', d: 'Reply when the danmaku mentions her or the streamer.' },
    replyOnQuestion: { t: 'Reply to questions', d: 'Reply when the danmaku looks like a question.' },
    replyOnSuperChat: { t: 'Always reply to Super Chat', d: 'Recommended to keep on.' },
    replyOnGuard: { t: 'Always reply to new guards', d: 'Recommended to keep on.' },
    blockNoise: { t: 'Filter noisy danmaku', d: 'Filters spam, pure numbers and pure emoji.' },
    forwardToQq: { t: 'Forward danmaku replies to QQ', d: 'No extra tokens.' },
    qqForwardTargets: { t: 'Forward targets (group / QQ numbers)', d: 'A group number or a private QQ number; separate several with commas.' },
    qqForwardFormat: { t: 'Forward format', d: 'reply = only her reply; full = with the viewer comment; important = only @her / gifts / SC.' },
    qqForwardGapSec: { t: 'Per-user forward gap (seconds)', d: 'Minimum gap for the same viewer. Different viewers do not block each other.' },
    qqForwardPerUser: { t: 'Throttle per viewer', d: 'On: each viewer has their own gap. Off: one global gap for everyone.' },
    qqForwardMinGapSec: { t: 'Min gap between any two forwards (sec)', d: 'Hard floor between any two forwards. 0 = off.' },
    qqForwardMaxPerMin: { t: 'Max forwards per minute', d: 'Extra forwards in the same minute are dropped. 0 = unlimited.' },
    qqDigestSec: { t: 'Live digest interval (sec)', d: 'Post a short digest (viewers + recent scene + room link) every N seconds while live. 0 = off.' },
    prioritizeGuard: { t: 'Guards and admins get priority', d: 'Guards and admins skip the throttle interval.' },
    minUserLevel: { t: 'Viewer live-level gate (UL / glory_level)', d: 'Reads info[4][0] = glory_level. 0 = no limit; 1 = skip level-0 newcomers. Guards, admins, fan-medal holders and anyone who gifted this session are exempt.' },
  },
} as const;

export function liveCueConfigGroup(language: Lang = 'zh'): ConfigGroup {
  const t = T[language] ?? T.zh;
  const zh = language !== 'en';
  return {
    id: 'world:live-cue',
    owner: 'world:live-cue',
    schema: {
      type: 'object',
      title: t.title,
      description: t.desc,
      properties: {
        'worlds.live-cue.streamUrl': {
          type: 'string',
          title: t.streamUrl.t,
          description: t.streamUrl.d,
        },
        'worlds.live-cue.useStoreEvents': {
          type: 'boolean',
          title: zh ? '从事件库补全礼物 / SC / 上舰' : 'Read gifts/SC/guards from the event store',
          description: zh
            ? '必须开着。B站的 overlay 弹幕流只带「礼物名×数量」，不带金额，照着它判断门槛会漏掉所有礼物。开着后改从 B站插件写进事件库的 bilibili.gift / superchat / guard 读取，带真实金额（yuan）与舰长等级（guardLevel），和官方插件同一份数据源。'
            : 'Required. Reads gifts/SC/guards from the Bilibili extension event store, including real price and guard level.',
          'x-hot': true,
        },
        'worlds.live-cue.gapSec': {
          type: 'integer',
          title: t.gapSec.t,
          description: t.gapSec.d,
          minimum: 0,
          maximum: 600,
          'x-hot': true,
        },
        'worlds.live-cue.gameGiftAlwaysReply': {
          type: 'boolean',
          title: language === 'zh' ? '游戏道具礼物必回（不看金额）' : 'Always reply to game-item gifts',
          description: language === 'zh'
            ? '开着时：礼物名命中「本局游戏」道具表（如人气票、鼓掌声、冰晶吊坠）→ 一律必回，不管只值 0.1 元。整蛊直播的核心玩法就靠这些道具，漏一个就少一段乐子。'
            : 'Gifts listed in the game item table always get a reply, regardless of price.',
          'x-hot': true,
        },
        'worlds.live-cue.guardBurstSec': {
          type: 'integer',
          title: language === 'zh' ? '房管/舰长连发间隔（秒）' : 'Guard/admin burst gap',
          description: language === 'zh'
            ? '同一个人（房管或舰长）在这个间隔内只回一条。昨晚实测他们连发时每条都唤醒，既烧 token 又打断直播节奏；20 秒是推荐值。'
            : 'Same guard/admin gets at most one reply per N seconds.',
          minimum: 0,
          maximum: 300,
        },
        'worlds.live-cue.sameUserGapSec': {
          type: 'integer',
          title: language === 'zh' ? '同一人两条必回的间隔（秒）' : 'Same-user gap',
          description: language === 'zh' ? '默认 15 秒。调小更热情但容易被单人刷屏带跑，调大更省 token。' : 'Default 15s.',
          minimum: 0,
          maximum: 300,
        },
        'worlds.live-cue.giftMergeSec': {
          type: 'integer',
          title: language === 'zh' ? '礼物合并窗口（秒，省 token）' : 'Gift merge window (s)',
          description: language === 'zh'
            ? '窗口内收到的多个礼物合并成「一条」交给模型，一次答完，不再每来一个礼物就叫她一次。0 = 关闭（每个礼物单独回）。6~10 秒是推荐值：既明显省 token，又不会让感谢来得太晚。'
            : 'Merge gifts arriving within N seconds into one model call. 0 disables.',
          minimum: 0,
          maximum: 60,
          'x-hot': true,
        },
        'worlds.live-cue.guardPortrait': {
          type: 'boolean',
          title: language === 'zh' ? '本月首舰自动画祝贺图' : 'Anniversary portrait on first guard of the month',
          description: language === 'zh'
            ? '舰长这个月第一次上舰时，自动抓他的 B站头像、画一张「他和小鲸鱼同框」的祝贺图发到粉丝群。同一人每月只画一次，账本在 worlds/live-cue/guard-portrait.json。每次约 0.05 元。'
            : 'Draw a welcome picture when someone becomes a guard for the first time this month.',
          'x-hot': true,
        },
        'worlds.live-cue.guardDrawPerDay': {
          type: 'integer',
          title: language === 'zh' ? '舰长每天可画几张（0 = 不限）' : 'Guard daily image quota',
          description: language === 'zh'
            ? '舰长每天免费出图的张数，默认 1。用掉之后再要，她会说清楚并约到明天，不会去调画图工具。账本在 worlds/live-cue/guard-draw.json，跨天自动清零。注意：只管直播间；QQ 私聊触发的不计入。'
            : 'Free images per guard per day. 0 = unlimited.',
          minimum: 0,
          maximum: 10,
          'x-hot': true,
        },
        'worlds.live-cue.petActionRate': {
          type: 'integer',
          title: language === 'zh' ? '桌宠表情动作频率（每 N 条带 1 次，0 = 不在直播里做）' : 'Pet action rate',
          description: language === 'zh'
            ? 'OBS 把桌宠画面投到直播间，观众看得见她的表情动作。2 = 平均每 2 条回复带一个【表情/动作】；1 = 每条都带；0 = 不带。'
            : 'How often replies include a pet expression/action. 0 = never.',
          minimum: 0,
          maximum: 5,
          'x-hot': true,
        },
        'worlds.live-cue.replyEmoteOnly': {
          type: 'boolean',
          title: language === 'zh' ? '纯表情弹幕也接一句（米饭/妙啊/打call）' : 'Reply to emote-only danmaku',
          description: language === 'zh'
            ? '开着时，观众只发一个 B站表情（如 [米饭]、[妙啊]）也会被当成互动，按机会型偶尔接一句（受「机会回应间隔」限频，不会每条都回）。昨晚这类纯表情被当噪声全丢了。'
            : 'Treat emote-only danmaku as interaction (chance-level, rate limited).',
          'x-hot': true,
        },
        'worlds.live-cue.emojiInDanmaku': {
          type: 'boolean',
          title: language === 'zh' ? '使用颜文字或 EMOJI 表情' : 'Use kaomoji or emoji',
          description: language === 'zh'
            ? '开着时她每条回复的句末都会带一个颜文字或 emoji（🐳😂 这类），直播间弹幕和转发到 QQ 群的内容都显示。B站弹幕只认自带表情，QQ 表情包发不进直播间。'
            : 'Put one kaomoji or emoji at the end of each reply; shown in danmaku and QQ forwards.',
          'x-hot': true,
        },
        'worlds.live-cue.bigGiftYuan': {
          type: 'integer',
          title: t.bigGiftYuan.t,
          description: t.bigGiftYuan.d,
          minimum: 0,
          maximum: 1000,
        },
        'worlds.live-cue.minGiftYuan': {
          type: 'number',
          title: t.minGiftYuan.t,
          description: t.minGiftYuan.d,
          minimum: 0,
          maximum: 1000,
          'x-hot': true,
        },
        'worlds.live-cue.cheapGiftAsChance': {
          type: 'boolean',
          title: zh ? '小额礼物也偶尔谢一句' : 'Acknowledge cheap gifts occasionally',
          description: zh
            ? '开着：低于门槛的礼物不静默丢弃，按「机会型」排队，有空就谢一句（受间隔和每小时上限约束）。关掉：小额礼物一律不理。整蛊直播里礼物多是「道具」，建议开着。'
            : 'When on, gifts below the threshold are queued as occasional replies instead of being dropped.',
          'x-hot': true,
        },
        'worlds.live-cue.replyOnAt': {
          type: 'boolean',
          title: t.replyOnAt.t,
          description: t.replyOnAt.d,
        },
        'worlds.live-cue.atKeywords': {
          type: 'string',
          title: '认这些词算「在叫她」',
          description: '英文逗号分隔。只有上面那个开关打开时才生效。默认：鱼宝、小鲸鱼、小金鱼、鲸鱼、然家小鲸鱼、然酱、然哥、主播。',
          'x-hot': true,
        },
        'worlds.live-cue.replyOnQuestion': {
          type: 'boolean',
          title: t.replyOnQuestion.t,
          description: t.replyOnQuestion.d,
        },
        'worlds.live-cue.replyOnSuperChat': {
          type: 'boolean',
          title: t.replyOnSuperChat.t,
          description: t.replyOnSuperChat.d,
        },
        'worlds.live-cue.replyOnGuard': {
          type: 'boolean',
          title: t.replyOnGuard.t,
          description: t.replyOnGuard.d,
        },
        'worlds.live-cue.scDelaySec': {
          type: 'integer',
          title: zh ? 'SC 读完再回（等待秒数）' : 'Seconds to finish reading an SC',
          description: zh
            ? 'SC 停留时间长、内容常常一屏，抢着回容易答非所问。填 8 = 收到 SC 后等 8 秒再让模型开口，把这整条看完再答。0 = 立即回。'
            : 'Wait this many seconds after an SC arrives before replying, so the whole message is read. 0 = immediate.',
          minimum: 0,
          maximum: 60,
          'x-hot': true,
        },
        'worlds.live-cue.blockNoise': {
          type: 'boolean',
          title: t.blockNoise.t,
          description: t.blockNoise.d,
          'x-hot': true,
        },
        'worlds.live-cue.prioritizeGuard': {
          type: 'boolean',
          title: t.prioritizeGuard.t,
          description: t.prioritizeGuard.d,
          'x-hot': true,
        },
        'worlds.live-cue.replyOnGift': {
          type: 'boolean',
          title: language === 'zh' ? '礼物必回（达到金额门槛）' : 'Always reply to gifts over threshold',
          description: language === 'zh'
            ? '开着时，礼物金额达到下方门槛就 100% 回应，不受限频影响。'
            : 'When on, gifts at or above the threshold always get a reply, bypassing throttles.',
          'x-hot': true,
        },
        'worlds.live-cue.chanceReply': {
          type: 'boolean',
          title: language === 'zh' ? '机会型回应（偶尔接一句）' : 'Occasional replies',
          description: language === 'zh'
            ? '开着时，没点名她、但有内容或像问句的弹幕，会按下面的间隔偶尔接一句，制造“在场感”。'
            : 'When on, non-addressed but interesting/questions get an occasional reply.',
          'x-hot': true,
        },
        'worlds.live-cue.chanceGapSec': {
          type: 'integer',
          title: language === 'zh' ? '机会型回应最短间隔（秒）' : 'Min seconds between occasional replies',
          description: language === 'zh'
            ? '两条“机会型”回应之间至少隔这么久。0 = 关闭机会型回应（只保留必回项）。'
            : 'Minimum gap between occasional replies. 0 = disable occasional replies.',
          minimum: 0,
          maximum: 1800,
          'x-hot': true,
        },
        'worlds.live-cue.blockHostile': {
          type: 'boolean',
          title: language === 'zh' ? '过滤不友善弹幕' : 'Filter hostile danmaku',
          description: language === 'zh'
            ? '开着时，辱骂、人身攻击、赶人的弹幕直接不理（舰长/房管也不豁免）。'
            : 'When on, insults and hostile remarks are ignored.',
          'x-hot': true,
        },
        'worlds.live-cue.hostileWords': {
          type: 'string',
          title: language === 'zh' ? '额外不友善词（逗号分隔）' : 'Extra hostile words',
          description: language === 'zh'
            ? '内置词表之外，你还想额外屏蔽的词。命中即不回应。可照抄咩播那种敏感词表的思路，只补直播场景特有的。'
            : 'Additional words to treat as hostile.',
        },
        'worlds.live-cue.blockWords': {
          type: 'string',
          title: language === 'zh' ? '屏蔽词（逗号分隔）' : 'Blocked words',
          description: language === 'zh'
            ? '照抄咩播「屏蔽敏感词汇」那一栏：命中的弹幕不主动接话（省 token、也不抢话）。注意只挡「机会型」，点名她、礼物、SC、上舰照回。单字词（左/右/滚）会挡掉很多闲聊，自己看着删。'
            : 'Danmaku containing these words will not get an occasional reply.',
          'x-hot': true,
        },
        'worlds.live-cue.blockPeerChat': {
          type: 'boolean',
          title: language === 'zh' ? '过滤「说给主播/别人」的弹幕' : 'Filter peer-to-peer chatter',
          description: language === 'zh'
            ? '开着时，@别人、「某某你…」这类明显不是对她说的弹幕不插话，省 token 也不抢主播的话。'
            : 'When on, danmaku addressed to other viewers/the streamer are ignored.',
          'x-hot': true,
        },
        'worlds.live-cue.blockUsers': {
          type: 'string',
          title: language === 'zh' ? '屏蔽名单（用户名，逗号分隔）' : 'Blocked usernames',
          description: language === 'zh'
            ? '照抄咩播的「屏蔽用户名」思路：填进来的名字（模糊包含即命中）发什么都不理，不感谢、不欢迎。适合对付专门来刷屏或带节奏的老熟人。'
            : 'Usernames listed here are ignored entirely.',
        },
        'worlds.live-cue.gameBrief': {
          type: 'string',
          title: language === 'zh' ? '本场玩法（开播前填）' : 'Tonight game brief',
          description: language === 'zh'
            ? '这一局怎么玩、有什么规矩，随手写两三句就行。它会被塞进每一条提示词，让她真的看懂局势，而不是只会「加油」。'
            : 'A few lines about tonight game; injected into every prompt.',
          'x-hot': true,
        },
        'worlds.live-cue.gamePackId': {
          type: 'string',
          title: language === 'zh' ? '当前游戏包' : 'Active game pack',
          description: language === 'zh'
            ? '换游戏就换这个 id。每个游戏一套独立的名称/道具/规则，互不覆盖；旧包留在 worlds/live-cue/games/ 里，随时切回来。'
            : 'Active game pack id; packs are isolated files.',
          'x-hot': true,
        },
        'worlds.live-cue.gameName': {
          type: 'string',
          title: language === 'zh' ? '游戏名' : 'Game name',
          description: language === 'zh' ? '只用于提示词标题，比如「小孩过马路 1.1」。' : 'Shown in the prompt header.',
        },
        'worlds.live-cue.gameItems': {
          type: 'string',
          title: language === 'zh' ? '道具表（一行一条：阵营|礼物|效果）' : 'Item table',
          description: language === 'zh'
            ? '红粉=帮主播，黑粉=整蛊。换游戏时整块替换，不会和上一局混。礼物名必须和 B站后台一致，否则判不出来。'
            : 'One line per item: side|gift|effect',
          'x-hot': true,
        },
        'worlds.live-cue.gameRules': {
          type: 'string',
          title: language === 'zh' ? '规则与术语（一行一条）' : 'Rules & terms',
          description: language === 'zh'
            ? '胜负条件、惩罚、暴击倍率、直播间黑话（嘎 / 小海 / 喀秋莎）都写这。她每轮都会带着，才不会说外行话。'
            : 'Win/lose, punishment, multiplier, slang.',
          'x-hot': true,
        },
        'worlds.live-cue.autoLiveNotice': {
          type: 'boolean',
          title: language === 'zh' ? '开播 / 下播自动在群里播报' : 'Auto live notice',
          description: language === 'zh'
            ? '开着时，平台一推「开播 / 下播」指令，她就用 qq_send 在粉丝群发一条；播报间隔与每日上限见下面两项。'
            : 'Post a notice to the QQ group on live start/stop.',
          'x-hot': true,
        },
        'worlds.live-cue.liveNoticeGapSec': {
          type: 'integer',
          title: language === 'zh' ? '两条播报最短间隔（秒）' : 'Notice gap (seconds)',
          description: language === 'zh' ? '默认 1800 秒。防止平台抖动导致开播/下播连发。' : 'Default 1800s.',
          minimum: 300,
          maximum: 21600,
        },
        'worlds.live-cue.liveNoticeMaxPerDay': {
          type: 'integer',
          title: language === 'zh' ? '每天最多播报几条' : 'Max notices per day',
          description: language === 'zh' ? '默认 6 条（开播+下播，留出重连余量）。' : 'Default 6.',
          minimum: 1,
          maximum: 20,
        },
        'worlds.live-cue.noticeStickerDelaySec': {
          type: 'integer',
          title: language === 'zh' ? '播报后多久补表情包（秒）' : 'Sticker delay after notice (s)',
          description: language === 'zh'
            ? '默认 60 秒。播报正文发完后，由插件单独补一条表情包，和「现场速报」一样是图文分开两条。'
            : 'Default 60s. Plugin sends the sticker as a separate message after the notice text.',
          minimum: 10,
          maximum: 600,
        },
        'worlds.live-cue.livePostDynamic': {
          type: 'boolean',
          title: language === 'zh' ? '下播后同步发 B 站动态' : 'Post Bilibili dynamic after stream',
          description: language === 'zh'
            ? '默认关闭。打开后，下播播报发完会再发一条 B 站动态：只写荣誉感、点名上榜的人，不提任何金额。依赖 biliwhale 已登录且开启自动提交；没登录会自动跳过，不影响群播报。'
            : 'Default off. Posts a Bilibili dynamic after the end notice. Requires biliwhale login + auto-submit.',
        },
        'worlds.live-cue.reportDynamic': {
          type: 'boolean',
          title: language === 'zh' ? '开播时发前一天战报（B站动态）' : 'Post previous-day report on stream start',
          description: language === 'zh'
            ? '默认关闭。打开后：每场下播结算时存一份战报（榜单+数据），下次开播的第一时间发一条 B站动态，只发一次；当晚群简报照旧，不会重复发到群里。文案由程序按模板生成，不含金额、不含开播时间承诺。'
            : 'Default off. Saves a report each stream end and posts it once as a Bilibili dynamic on the next stream start.',
        },
        'worlds.live-cue.ownerUids': {
          type: 'string',
          title: language === 'zh' ? '主人 B站 UID（下播信号只认这个）' : 'Owner Bilibili UIDs',
          description: language === 'zh'
            ? '逗号分隔。只有这些 UID 在直播间说「下播啦/要下播」才会触发榜单校准（全场只拉一次）。默认留空（只认 ownerNames）；填了就只认这些 UID。'
            : 'Comma-separated UIDs whose 「下播」 counts as a go-offline signal.',
        },
        'worlds.live-cue.ownerNames': {
          type: 'string',
          title: language === 'zh' ? '主人 B站昵称（兜底）' : 'Owner nicknames',
          description: language === 'zh'
            ? '逗号分隔。UID 匹配不到时按昵称认人，默认「然酱丶重生版」。'
            : 'Comma-separated nicknames, used when UID is missing.',
        },
        'worlds.live-cue.rankRuid': {
          type: 'number',
          title: language === 'zh' ? '直播间 UID（看自己在榜上第几）' : 'Room owner UID',
          description: language === 'zh'
            ? '一般不用改。只影响官方榜接口里「我排第几」，留 0 也能正常拉榜单。'
            : 'Only affects your own position in the official rank API.',
        },
        'worlds.live-cue.portraitOwner': {
          type: 'string',
          title: language === 'zh' ? '主人 QQ 号（祝贺画确认人）' : 'Owner QQ',
          description: language === 'zh'
            ? '首舰祝贺画只发给这个人确认，默认留空（不自动确认）。'
            : 'Guard portrait drafts go to this QQ for confirmation.',
        },
        'worlds.live-cue.liveNoticeTarget': {
          type: 'string',
          title: language === 'zh' ? '播报发到哪（群号 / u:QQ）' : 'Notice target',
          description: language === 'zh'
            ? '默认留空。想先自己看效果就填 u:你的QQ号，只发私聊，确认没问题再改回群。'
            : 'Group number or u:<qq> for private test.',
        },
        'worlds.live-cue.blockPatterns': {
          type: 'string',
          title: language === 'zh' ? '游戏插件指令（正则，一行一条）' : 'Game command patterns',
          description: language === 'zh'
            ? '猫猫养成这类插件会把「喵 / 左3 / 购买12」刷满屏。这些不是给她的对话，命中就直接丢，既不烧 token 也不会答非所问。'
            : 'Regex list; matching danmaku are dropped before the model.',
          'x-hot': true,
        },
        'worlds.live-cue.promoCue': {
          type: 'boolean',
          title: language === 'zh' ? '穿插引导话术（上舰 / 加群 / 拉红粉）' : 'Promo cues',
          description: language === 'zh'
            ? '开着时，在她本来就要回话的轮次里，顺带提一句引导（不额外叫醒、不多烧 token）。'
            : 'Occasionally append a promo line to replies.',
          'x-hot': true,
        },
        'worlds.live-cue.promoGapSec': {
          type: 'integer',
          title: language === 'zh' ? '两条引导最短间隔（秒）' : 'Promo gap (seconds)',
          description: language === 'zh' ? '默认 600 秒（10 分钟）一次，太密会像电视购物。' : 'Default 600s.',
          minimum: 60,
          maximum: 7200,
        },
        'worlds.live-cue.promoTopics': {
          type: 'string',
          title: language === 'zh' ? '引导话术轮换（一行一条）' : 'Promo topics',
          description: language === 'zh' ? '按顺序轮着来，写完就不用管了。' : 'Rotated line by line.',
        },
        'worlds.live-cue.selfNames': {
          type: 'string',
          title: language === 'zh' ? '她自己的昵称（防自回声）' : 'Her own nicknames',
          description: language === 'zh'
            ? '逗号分隔。B 站会把她自己发的弹幕原样推回来，不挡住的话她会跟自己聊起来（实测踩过）。改了昵称记得同步这里。'
            : 'Danmaku from these names are ignored (prevents replying to her own messages).',
          'x-hot': true,
        },
        'worlds.live-cue.forwardToQq': {
          type: 'boolean',
          title: t.forwardToQq.t,
          description: t.forwardToQq.d,
          'x-hot': true,
        },
        'worlds.live-cue.qqForwardTargets': {
          type: 'string',
          title: t.qqForwardTargets.t,
          description: t.qqForwardTargets.d,
        },
        'worlds.live-cue.qqForwardFormat': {
          type: 'string',
          title: t.qqForwardFormat.t,
          description: t.qqForwardFormat.d,
          enum: ['reply', 'full', 'important'],
        },
        'worlds.live-cue.qqForwardGapSec': {
          type: 'integer',
          title: t.qqForwardGapSec.t,
          description: t.qqForwardGapSec.d,
          minimum: 5,
          maximum: 3600,
        },
        'worlds.live-cue.qqForwardPerUser': {
          type: 'boolean',
          title: t.qqForwardPerUser.t,
          description: t.qqForwardPerUser.d,
        },
        'worlds.live-cue.qqForwardMinGapSec': {
          type: 'integer',
          title: t.qqForwardMinGapSec.t,
          description: t.qqForwardMinGapSec.d,
          minimum: 0,
          maximum: 120,
        },
        'worlds.live-cue.qqForwardMaxPerMin': {
          type: 'integer',
          title: t.qqForwardMaxPerMin.t,
          description: t.qqForwardMaxPerMin.d,
          minimum: 0,
          maximum: 60,
        },
        'worlds.live-cue.qqDigestSec': {
          type: 'integer',
          title: t.qqDigestSec.t,
          description: t.qqDigestSec.d,
          minimum: 0,
          maximum: 7200,
        },
        'worlds.live-cue.minUserLevel': {
          type: 'integer',
          title: t.minUserLevel.t,
          description: t.minUserLevel.d,
          minimum: 0,
          maximum: 100,
          'x-hot': true,
        },
        'worlds.live-cue.sendDanmaku': {
          type: 'boolean',
          title: '把回复同步发到直播间弹幕',
          description: '开着时，她对弹幕的回复会用同一段文字发进 B 站直播间，不额外调用模型。需要先填 bili_jct 与房间号。',
          'x-hot': true,
        },
        'worlds.live-cue.danmakuBlockWords': {
          type: 'string',
          title: '自定义屏蔽词（弹幕）',
          description: '填在这里的词，只要她的话里出现，就不往直播间发（气泡和 QQ 不受影响）。多个词用逗号或换行分隔，至少 2 个字。内置只拦金额、联系方式、平台敏感词，不拦下播时间这类正常信息。',
        },
        'worlds.live-cue.danmakuGuard': {
          type: 'boolean',
          title: '弹幕敏感词过滤',
          description: '开着时，发弹幕前会检查钱、联系方式、内部安排等敏感内容，命中就这条不发（气泡和 QQ 消息不受影响）。建议保持开启。',
          'x-hot': true,
        },
        'worlds.live-cue.mirrorUnownedSay': {
          type: 'boolean',
          title: '主人对话也同步到弹幕',
          description: '开着时，她回应主人的话（没有绑定任何弹幕事件的那类）也会排队发进直播间弹幕。关掉则只在回复粉丝时发。',
          'x-hot': true,
        },
        'worlds.live-cue.danmakuCookie': {
          type: 'string',
          title: '发弹幕 Cookie',
          description: '浏览器登录 B 站后复制整条 Cookie，需同时包含 SESSDATA 和 bili_jct。只存本地。SESSDATA 留空时自动复用 B站直播间插件里那份。',
        },
        'worlds.live-cue.danmakuRoomId': {
          type: 'integer',
          title: '发弹幕的直播间号',
          description: '真实房间号（不是短号），例如 12345678。',
          minimum: 0,
        },
        'worlds.live-cue.danmakuMaxLen': {
          type: 'integer',
          title: '弹幕最大字数',
          description: 'B 站直播间实测上限 80 字（2026-11-05 主播实测）。填 80 即可，超出会被接口截断。',
          minimum: 5,
          maximum: 80,
        },
        'worlds.live-cue.danmakuGapSec': {
          type: 'integer',
          title: '两条弹幕最短间隔（秒）',
          description: '防止连续刷屏被风控。实测约 8 秒一条，建议保持 8；不够间隔会排队补发，发送失败还会自动退避 120 秒。',
          minimum: 3,
          maximum: 300,
        },
        'worlds.live-cue.replyMaxChars': {
          type: 'integer',
          title: '回应字数上限',
          description: '写进提示词，让模型一次只吐这么长。发弹幕时会自动收紧到「弹幕最大字数」（20），避免半句话被截断。',
          minimum: 10,
          maximum: 120,
        },
        'worlds.live-cue.maxPerHour': {
          type: 'integer',
          title: '每小时最多推给模型几条',
          description: '硬上限，只限制「机会型」回应；必回项不算在内。0 = 不限制。默认 90，想更活跃就调大。',
          minimum: 0,
          maximum: 600,
          'x-hot': true,
        },
        'worlds.live-cue.sendEnter': {
          type: 'boolean',
          title: '进场时欢迎',
          description: '开着时，有特殊身份（舰长/房管/粉丝牌达标）的人进场会触发一次欢迎。',
          'x-hot': true,
        },
        'worlds.live-cue.enterMedalLevel': {
          type: 'integer',
          title: '进场欢迎的粉丝牌门槛',
          description: '粉丝牌等级达到这个数才欢迎。0 = 不按牌子筛，只按身份。',
          minimum: 0,
          maximum: 60,
        },
        'worlds.live-cue.guardWelcome': {
          type: 'boolean',
          title: language === 'zh' ? '舰长进场必欢迎（有仪式感）' : 'Guard entry welcome',
          description: language === 'zh'
            ? '开着时，舰长 / 提督 / 总督 进直播间一定会被点名欢迎，而且每次换一种说法，不是复读「欢迎欢迎」。'
            : 'Guards entering the room always get a fresh, ceremonial welcome.',
          'x-hot': true,
        },
        'worlds.live-cue.guardWelcomeMaxPerDay': {
          type: 'number',
          title: language === 'zh' ? '当天欢迎总次数上限' : 'Daily guard welcome cap',
          description: language === 'zh'
            ? '当天欢迎舰长进场的总次数上限（默认 100）。到顶后新进场按普通进场处理，避免刷屏；每人每天的次数由上一项控制。'
            : 'Max guard welcomes per day (default 100).',
        },
        'worlds.live-cue.guardWelcomePerDay': {
          type: 'integer',
          title: language === 'zh' ? '每人每天最多欢迎几次' : 'Guard welcomes per person per day',
          description: language === 'zh'
            ? '按「人 + 自然日」计数，跨天自动清零，重启不丢。1 = 同一个人一天只隆重欢迎一次，后面再进出就按普通进场处理。0 = 不限次数。'
            : 'Per-person daily quota; 1 = one ceremonial welcome per person per day, 0 = unlimited.',
          minimum: 0,
          maximum: 50,
          'x-hot': true,
        },
        'worlds.live-cue.guardWelcomeStyles': {
          type: 'string',
          title: language === 'zh' ? '欢迎词参考风格（可留空）' : 'Welcome tone hints (optional)',
          description: language === 'zh'
            ? '默认留空：每次都由她看着「当时直播间正在发生什么」现编，不用固定话术。想限定方向时再填（逗号分隔，如「整蛊风,毒舌风」）。'
            : 'Leave empty to let her improvise from the live scene.',
        },
        'worlds.live-cue.sendAudience': {
          type: 'boolean',
          title: '人气/榜单也推给模型',
          description: '关（默认）：只记录不唤醒，省 token。开：人气变化也会让她说一句。',
        },
        'worlds.live-cue.danmakuBiliJct': {
          type: 'string',
          title: '发弹幕用的 bili_jct',
          description: 'SESSDATA 会自动从上方的 B站直播间插件复用，这里只补 bili_jct 这一项即可。',
        },
      },
    },
  } as ConfigGroup;
}
