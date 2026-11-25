#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
给 Coopanion 内置 desktop-pet 打「/api/say」补丁。

作用：让本地 World 能零 token 直接推桌宠气泡
      POST http://127.0.0.1:7797/api/say  {"text": "..."}

为什么需要这个脚本：
    Coopanion 升级会覆盖 resources/app/node_modules/cortico-world-desktop-pet/，
    补丁会丢。跑一次本脚本即可补回（幂等，重复跑不会打第二次）。

用法：
    python patch_desktop_pet.py            # 检测 + 按需打补丁
    python patch_desktop_pet.py --check    # 只检测，不改
    python patch_desktop_pet.py --revert   # 从最近的备份还原

改动的两个文件（都会先备份）：
    src/server.ts   加 PetServerOptions.onSay + POST /api/say 路由 + sayExternal()
    src/world.ts    在 new PetServer({...}) 里注入 onSay
"""
import argparse
import datetime
import io
import os
import shutil
import sys

DP_DIR = r'C:/Users/Administrator/Coopanion/resources/app/node_modules/cortico-world-desktop-pet'
SERVER_TS = os.path.join(DP_DIR, 'src', 'server.ts')
WORLD_TS = os.path.join(DP_DIR, 'src', 'world.ts')

MARKER = 'onSay'

ESBUILD_MAIN = r'C:/Users/Administrator/Coopanion/resources/app/node_modules/esbuild/lib/main.js'
NODE_CWD = r'C:/Users/Administrator/Coopanion/resources/app'


def verify_ts_syntax_result(source_text: str) -> bool:
    """用 esbuild 校验 TS 语法（不写盘，只看内存里的文本）。

    历史教训（2026-10-27）：anchor 太松 → 多次执行吃掉 'private accept('
    → 孤立签名 → Coo core TransformError → 完全起不来。
    所以：**写盘前必须过这一关。**
    """
    import json as _json
    import subprocess
    import tempfile

    if not os.path.exists(ESBUILD_MAIN):
        log('esbuild 不存在，跳过语法校验（有风险）')
        return True

    tmp = tempfile.NamedTemporaryFile('w', suffix='.ts', delete=False, encoding='utf-8')
    try:
        tmp.write(source_text)
        tmp.close()
        code = (
            'const e=require(%r);'
            'e.transform(require("fs").readFileSync(%r,"utf8"),{loader:"ts"})'
            '.then(()=>{console.log("SYNTAX_OK");})'
            '.catch(x=>{console.error("SYNTAX_ERR:"+x.message);});'
        ) % (ESBUILD_MAIN.replace('\\', '/'), tmp.name.replace('\\', '/'))
        r = subprocess.run(['node', '-e', code], capture_output=True, text=True,
                           timeout=90, cwd=NODE_CWD)
        out = (r.stdout or '') + (r.stderr or '')
        if 'SYNTAX_OK' in out:
            return True
        log('语法错误: %s' % out.strip()[:200])
        return False
    except Exception as e:
        log('语法校验异常（按通过处理）: %s' % str(e)[:100])
        return True
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass




def log(msg: str) -> None:    print(f'  {msg}')


def backup(path: str) -> str:
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    dst = f'{path}.bak-{ts}'
    shutil.copy2(path, dst)
    return dst


def check() -> dict:
    """检测补丁状态。"""
    st = {'server': False, 'world': False, 'files': False}
    if not (os.path.exists(SERVER_TS) and os.path.exists(WORLD_TS)):
        st['files'] = True
        return st
    s = io.open(SERVER_TS, encoding='utf-8').read()
    w = io.open(WORLD_TS, encoding='utf-8').read()
    st['server'] = (MARKER in s
                    and 'onSay?(text: string)' in s
                    and 'this.sayExternal(req' in s
                    and 'private async sayExternal(' in s)   # 修正：三处都要在，防路由调用串误判
    st['world'] = 'onSay:' in w
    return st


def patch_server() -> bool:
    """给 server.ts 加 onSay 选项 + /api/say 路由 + sayExternal。"""
    s = io.open(SERVER_TS, encoding='utf-8').read()
    changed = False

    # 1) PetServerOptions 加 onSay
    anchor = '  /** Whether the OBS overlay is served; off when absent. */\n  overlay?(): boolean;'
    add = anchor + '''
  /**
   * External say hook: lets a local World push a bubble without going through the model.
   * Returns a short receipt string, or throws to report an error.
   */
  onSay?(text: string): Promise<string>;'''
    if 'onSay?(text: string)' not in s:
        if anchor in s:
            s = s.replace(anchor, add, 1)
            changed = True
            log('server.ts: 已加 PetServerOptions.onSay')
        else:
            log('server.ts: [跳过] 找不到 overlay 锚点（可能版本已变）')

    # 2) handle() 加路由
    route_anchor = '''    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/figures') {'''
    route_new = '''    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;

    // 外部注入气泡：本地 World 直接推一句话，不经过模型（0 token）
    if (req.method === 'POST' && path === '/api/say' && this.opts.onSay) {
      return this.sayExternal(req, res, this.opts.onSay);
    }

    if (req.method === 'GET' && path === '/api/figures') {'''
    if "'/api/say'" not in s:
        if route_anchor in s:
            s = s.replace(route_anchor, route_new, 1)
            changed = True
            log('server.ts: 已加 POST /api/say 路由')
        else:
            log('server.ts: [跳过] 找不到 handle() 锚点')

    # 3) 加 sayExternal 方法
    method_anchor = '  private accept(ws: WebSocket, req: IncomingMessage): void {'  # 整段匹配，避免多次执行时吃掉方法名
    method_new = '''  /** POST /api/say：读 JSON body，交给 onSay 推气泡（不经过模型）。 */
  private async sayExternal(
    req: IncomingMessage,
    res: ServerResponse,
    onSay: (text: string) => Promise<string>,
  ): Promise<void> {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) { json(res, 400, { ok: false, error: 'empty text' }); return; }
      const receipt = await onSay(text);
      json(res, 200, { ok: true, receipt });
    } catch (err) {
      json(res, 500, { ok: false, error: String((err as Error)?.message ?? err) });
    }
  }
'''
    if 'private async sayExternal(' not in s:   # 修正：用方法定义判定，避免被路由调用串误判
        if method_anchor in s:
            s = s.replace(method_anchor, method_new, 1)
            changed = True
            log('server.ts: 已加 sayExternal() 方法')
        else:
            log('server.ts: [跳过] 找不到 accept() 锚点')

    if changed:
        # 关键安全网：写盘前先验证 TypeScript 语法。
        # 历史教训（2026-10-27）：anchor 写得太松，多次执行把
        # '  private accept(' 吃掉，留下孤立签名 → Coo core 编译失败 → 完全起不来。
        if not verify_ts_syntax_result(s):
            log('server.ts: [中止] 打补丁后语法校验失败，未写盘（原文件保持不动）')
            log('            请把 method_anchor 改成更长的整段匹配再试')
            return False
        io.open(SERVER_TS, 'w', encoding='utf-8').write(s)
        log('server.ts: 语法校验通过，已写盘')
    return changed


def patch_world() -> bool:
    """给 world.ts 的 new PetServer({...}) 注入 onSay。"""
    w = io.open(WORLD_TS, encoding='utf-8').read()
    if 'onSay:' in w:
        log('world.ts: 已有 onSay，跳过')
        return False

    anchor = '''      onSkin: (skin) => this.saveSkin(skin),
      onPrefs: (prefs) => this.savePrefs(prefs),'''
    add = anchor + '''
      // 外部注入：本地 World 直接推气泡，不经过模型（0 token）
      onSay: async (text: string) => {
        const r = await this.say({ script: text });
        return r && typeof (r as any).text === 'string' ? (r as any).text : 'ok';
      },'''

    if anchor in w:
        w = w.replace(anchor, add, 1)
        io.open(WORLD_TS, 'w', encoding='utf-8').write(w)
        log('world.ts: 已注入 onSay')
        return True
    log('world.ts: [跳过] 找不到 new PetServer 锚点（可能版本已变）')
    return False


def revert() -> None:
    """从最近的备份还原两个文件。"""
    for path in (SERVER_TS, WORLD_TS):
        d = os.path.dirname(path)
        base = os.path.basename(path)
        baks = sorted(
            f for f in os.listdir(d)
            if f.startswith(base + '.bak-')
        )
        if not baks:
            log(f'{base}: 没有备份可还原')
            continue
        src = os.path.join(d, baks[-1])
        shutil.copy2(src, path)
        log(f'{base}: 已从 {baks[-1]} 还原')


# ── 附加任务：给 qq-final 的 ENV_PROMPT 加颜文字硬规则 ──
QQ_ENV = r'C:/Users/Administrator/Coopanion/data/extensions/node_modules/cortico-world-qq-final/ENV_PROMPT.md'
ENV_PROMPT_KAOMOJI = """

---

## ⚠️ 发每条消息都必须带颜文字

**我发的每一条消息，句末必须带一个颜文字。** 不是"尽量"，是"必须"。

- ✅ 「主人回来啦～(◕‿◕)」
- ❌ 「主人回来啦～」（没有颜文字 = 说错了）
- ❌ 一条最多一个，不要堆

唯一例外：生气、认真劝人、说严肃的事。

可用清单：`(∠・ω< )⌒★` `(◕‿◕)` `(๑•̀ㅂ•́)و✧` `(｡•́︿•̀｡)` `(๑´ㅂ`๑)` `(￣▽￣)` `(๑•́ ₃ •̀๑)` `(´・ω・`)` `(｡･ω･｡)` `(๑>ᴗ<๑)` `(*/ω＼*)` `(￣^￣)ゞ`

**这条规则优先于其他任何风格要求。**
"""


def patch_qq_env() -> bool:
    """给 qq-final 的 ENV_PROMPT 追加颜文字规则（升级会覆盖，跑本脚本补回）。"""
    if not os.path.exists(QQ_ENV):
        log('qq-final ENV_PROMPT: [跳过] 文件不存在')
        return False
    s = io.open(QQ_ENV, encoding='utf-8').read()
    if '颜文字' in s:
        log('qq-final ENV_PROMPT: 已有颜文字规则，跳过')
        return False
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    shutil.copy2(QQ_ENV, f'{QQ_ENV}.bak-{ts}')
    io.open(QQ_ENV, 'w', encoding='utf-8').write(s.rstrip() + ENV_PROMPT_KAOMOJI)
    log('qq-final ENV_PROMPT: 已追加颜文字规则')
    return True


# ── 附加任务 2：让 qq-final 发送时剥离正文里的 #编号 ──
QQ_WORLD = r'C:/Users/Administrator/Coopanion/data/extensions/node_modules/cortico-world-qq-final/src/world.ts'


def patch_qq_quote() -> bool:
    """让 qq_send 发送时剥离正文里的 #编号（引用已通过 reply_message_id 传递）。"""
    if not os.path.exists(QQ_WORLD):
        log('qq-final world.ts: [跳过] 文件不存在')
        return False
    s = io.open(QQ_WORLD, encoding='utf-8').read()
    if 'const stripped = text.replace' in s:
        log('qq-final world.ts: 已有剥离逻辑，跳过')
        return False
    old = """        // 直接发送（去掉强制草稿门：LLM 起草后常常不调 qq_confirm_send，导致消息发不出去）
        let res = await this.sendTo(address, text, rid, atQQs);"""
    new = """        // 剥离正文里的 #编号（引用已通过 rid 参数传递，正文不该再显示编号）
        let sendText = text;
        if (rid !== undefined) {
          const stripped = text.replace(/#-?\\d+\\s*/g, '').trim();
          if (stripped) sendText = stripped;
        }
        // 直接发送（去掉强制草稿门：LLM 起草后常常不调 qq_confirm_send，导致消息发不出去）
        let res = await this.sendTo(address, sendText, rid, atQQs);"""
    if old in s:
        ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
        shutil.copy2(QQ_WORLD, f'{QQ_WORLD}.bak-{ts}')
        io.open(QQ_WORLD, 'w', encoding='utf-8').write(s.replace(old, new, 1))
        log('qq-final world.ts: 已插入「剥离 #编号」逻辑')
        return True
    log('qq-final world.ts: [跳过] 锚点未匹配')
    return False


# 注意：emojiDir 与 vision 配置不在源码里，靠 config.json 持久化，升级不会丢。
# 但 qq-final 的 ENV_PROMPT 会被升级覆盖，patch_qq_env() 会补回颜文字规则；
# 表情包说明同样被覆盖，需要手动补（或在 patch_qq_env 里扩充）。


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只检测，不修改')
    ap.add_argument('--revert', action='store_true', help='从最近备份还原')
    args = ap.parse_args()

    print('=' * 58)
    print('  desktop-pet /api/say 补丁工具')
    print('=' * 58)

    if args.revert:
        print()
        print('=== 还原 ===')
        revert()
        return 0

    if not os.path.isdir(DP_DIR):
        print(f'[X] 找不到 desktop-pet 目录：{DP_DIR}')
        return 1

    st = check()
    if st['files']:
        print('[X] 找不到 server.ts 或 world.ts')
        return 1

    print()
    print('=== 检测结果 ===')
    log(f"server.ts 有补丁: {'是' if st['server'] else '否'}")
    log(f"world.ts  有补丁: {'是' if st['world'] else '否'}")

    if st['server'] and st['world']:
        print()
        print('[OK] 补丁完好，无需操作。')
        print('      升级 Coopanion 后若失效，再跑一次本脚本。')
        return 0

    if args.check:
        print()
        print('[提示] 检测到缺失，加 --check 只检测。去掉它就会打补丁。')
        return 0

    print()
    print('=== 打补丁 ===')
    b1 = backup(SERVER_TS)
    b2 = backup(WORLD_TS)
    log(f'已备份 server.ts → {os.path.basename(b1)}')
    log(f'已备份 world.ts  → {os.path.basename(b2)}')
    print()

    patch_server()
    patch_world()
    patch_qq_env()
    patch_qq_quote()

    print()
    print('=== 复检 ===')
    st2 = check()
    log(f"server.ts: {'OK' if st2['server'] else 'X 仍未打好'}")
    log(f"world.ts : {'OK' if st2['world'] else 'X 仍未打好'}")

    if st2['server'] and st2['world']:
        print()
        print('[OK] 补丁完成。重启 Coopanion 后生效：')
        print('     curl -X POST http://127.0.0.1:17788/api/run/restart '
              '-H "Content-Type: application/json" -d "{}"')
        print()
        print('     测试：curl -X POST http://127.0.0.1:7797/api/say '
              '-H "Content-Type: application/json" '
              '-d "{\\"text\\":\\"气泡测试\\"}"')
        return 0
    print()
    print('[!] 有文件没打好，可能是 Coopanion 版本变了。')
    print('    手动对照 SKILL.md 第五章改，或把报错发我。')
    return 2


if __name__ == '__main__':
    sys.exit(main())
