#!/usr/bin/env python3
"""
fix_patch_bug.py —— 一次性根治 patch_desktop_pet.py 的 anchor bug

问题：
    patch_server() 的 method_anchor 只匹配 '  private accept('
    多次执行时会把 'private accept(' 本身吃掉 → 留下孤立的
    'ws: WebSocket, req: IncomingMessage): void {' → TypeScript 语法错误
    → Coo core 编译失败 → 完全起不来

修复两件事：
    1. 修当前已损坏的 server.ts（把 private accept( 补回来）
    2. 修 patch_desktop_pet.py 的 anchor（改成完整签名，永不误伤）
    3. 用 esbuild 验证语法，通过才算成功
"""

import io
import os
import shutil
import datetime
import subprocess
import sys

DP = r'C:/Users/Administrator/Coopanion/resources/app/node_modules/cortico-world-desktop-pet/src/server.ts'
PATCH = r'C:/Users/Administrator/Projects/cortico-world-live-cue/scripts/patch_desktop_pet.py'
ESBUILD = r'C:/Users/Administrator/Coopanion/resources/app/node_modules/esbuild/lib/main.js'
NODE_CWD = r'C:/Users/Administrator/Coopanion/resources/app'

FULL_SIG = '  private accept(ws: WebSocket, req: IncomingMessage): void {'
BROKEN_SIG = 'ws: WebSocket, req: IncomingMessage): void {'
NL = chr(10)


def log(msg):
    print(msg)


def verify_syntax(path):
    """用 esbuild 检查 TS 语法，返回 (ok, message)"""
    code = (
        'const e=require(%r);'
        'e.transform(require("fs").readFileSync(%r,"utf8"),{loader:"ts"})'
        '.then(()=>{console.log("SYNTAX_OK");})'
        '.catch(x=>{console.error("SYNTAX_ERR:"+x.message);});'
    ) % (ESBUILD.replace('\\', '/'), path.replace('\\', '/'))
    try:
        r = subprocess.run(['node', '-e', code], capture_output=True, text=True,
                           timeout=90, cwd=NODE_CWD)
        out = (r.stdout or '') + (r.stderr or '')
        return ('SYNTAX_OK' in out), out.strip()[:300]
    except Exception as e:
        return False, 'esbuild 调用失败: %s' % str(e)[:120]


def fix_server():
    log('=== 第 1 步：修 server.ts ===')
    if not os.path.exists(DP):
        log('  [X] 找不到 server.ts: %s' % DP)
        return False

    s = io.open(DP, encoding='utf-8', newline='').read()

    if BROKEN_SIG not in s:
        if FULL_SIG in s:
            log('  [OK] 已经是正确状态（完整签名在，无孤立签名）')
            return True
        log('  [?] 既没有孤立签名也没有完整签名，需人工检查')
        return False

    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    shutil.copy2(DP, DP + '.bak-autofix-' + ts)

    # 逐个替换孤立签名（每处前面补 private accept(）
    fixed = s.replace(NL + BROKEN_SIG, NL + FULL_SIG)
    # 处理文件开头就是孤立签名的情况
    if fixed.startswith(BROKEN_SIG):
        fixed = FULL_SIG + fixed[len(BROKEN_SIG):]

    io.open(DP, 'wb').write(fixed.encode('utf-8'))
    log('  [OK] 已修复孤立签名（备份 .bak-autofix-%s）' % ts)

    ok, msg = verify_syntax(DP)
    if ok:
        log('  [OK] esbuild 语法验证通过')
        return True
    log('  [X] 语法仍有问题: %s' % msg)
    return False


def fix_patch_script():
    log('')
    log('=== 第 2 步：修 patch_desktop_pet.py 的 anchor ===')
    if not os.path.exists(PATCH):
        log('  [X] 找不到: %s' % PATCH)
        return False

    s = io.open(PATCH, encoding='utf-8', newline='').read()

    old_anchor = "    method_anchor = '  private accept('"
    new_anchor = ("    method_anchor = '  private accept(ws: WebSocket, req: IncomingMessage): void {'"
                  "  # 整段匹配，避免多次执行时吃掉方法名")

    if new_anchor.split('  #')[0].strip() in s:
        log('  [OK] anchor 已是整段匹配，无需修改')
        return True

    if old_anchor not in s:
        log('  [?] 找不到旧 anchor，可能是别的写法：')
        for i, line in enumerate(s.split(NL), 1):
            if 'method_anchor' in line:
                log('    行 %d: %s' % (i, line.strip()[:100]))
        return False

    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    shutil.copy2(PATCH, PATCH + '.bak-autofix-' + ts)
    io.open(PATCH, 'wb').write(s.replace(old_anchor, new_anchor, 1).encode('utf-8'))
    log('  [OK] anchor 已改为整段匹配（备份 .bak-autofix-%s）' % ts)
    return True


def main():
    log('=' * 56)
    log('  根治 patch_desktop_pet.py 的 anchor bug')
    log('=' * 56)
    log('')

    r1 = fix_server()
    r2 = fix_patch_script()

    log('')
    log('=== 最终验证 ===')
    ok, msg = verify_syntax(DP)
    log('  server.ts 语法: %s' % ('[OK] 通过' if ok else '[X] ' + msg))

    s = io.open(DP, encoding='utf-8', newline='').read()
    log('  含 private accept(: %s' % ('是' if FULL_SIG in s else '否'))
    log('  含 sayExternal(: %s' % ('是' if 'sayExternal(' in s else '否'))
    log('  含孤立签名: %s' % ('是 [X]' if NL + BROKEN_SIG in s else '否 [OK]'))

    if r1 and r2 and ok:
        log('')
        log('[SUCCESS] 全部修复完成，可以安全重启 Coo')
        return 0
    log('')
    log('[PARTIAL] 有步骤未完成，需人工检查')
    return 1


if __name__ == '__main__':
    sys.exit(main())
