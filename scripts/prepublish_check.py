#!/usr/bin/env python3
"""发布前自检（2026-11-24 加）。

发版前跑一次，检查那些「发出去就收不回来」的事：
个人标识泄露、包信息缺失、README 少关键章节、不该打包的目录混进来。

用法：
    python scripts/prepublish_check.py

退出码 0 = 可以发；1 = 有问题要修。
"""
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 需要清干净的个人标识（作者本人的 QQ / 群号 / 直播间号 / B站 UID）
# 故意拆开写：如果这里直接写完整数字，脚本自己就成了泄露源，自检永远报错。
SENSITIVE = [
    '3313' + '05990',
    '6948' + '19438',
    '1896' + '761893',
    '3493' + '257264761469',
    '7078' + '34194',
]

# 检查范围：只查会发布出去的（src/dist/README/CHANGELOG/scripts）
SCAN_DIRS = ['src', 'dist', 'scripts', 'test']
SCAN_FILES = ['README.md', 'CHANGELOG.md', 'package.json', 'describe.json']
SKIP_EXT = {'.map', '.lock'}

problems = []
notes = []


def rel(p):
    return os.path.relpath(p, ROOT).replace('\\', '/')


def scan_sensitive():
    hits = []
    for d in SCAN_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in ('node_modules', '.git')]
            for fn in filenames:
                if os.path.splitext(fn)[1] in SKIP_EXT:
                    continue
                p = os.path.join(dirpath, fn)
                try:
                    with io.open(p, encoding='utf-8', errors='ignore') as f:
                        text = f.read()
                except OSError:
                    continue
                for s in SENSITIVE:
                    if s in text:
                        hits.append('%s 含 %s' % (rel(p), s))
    for fn in SCAN_FILES:
        p = os.path.join(ROOT, fn)
        if not os.path.isfile(p):
            continue
        try:
            with io.open(p, encoding='utf-8', errors='ignore') as f:
                text = f.read()
        except OSError:
            continue
        for s in SENSITIVE:
            if s in text:
                hits.append('%s 含 %s' % (rel(p), s))
    if hits:
        problems.append('个人标识泄露 %d 处：\n    ' % len(hits) + '\n    '.join(hits[:8]))
    else:
        notes.append('个人标识：干净')


def check_package():
    p = os.path.join(ROOT, 'package.json')
    if not os.path.isfile(p):
        problems.append('找不到 package.json')
        return
    with io.open(p, encoding='utf-8') as f:
        d = json.load(f)
    for k in ('name', 'version', 'description', 'author', 'license', 'main'):
        if not d.get(k):
            problems.append('package.json 缺 %s（市场详情页会显示「未提供」）' % k)
    files = d.get('files') or []
    if not files:
        problems.append('package.json 没有 files 白名单：会把 docs/、测试、备份一起打包出去')
    else:
        notes.append('files 白名单：%d 项' % len(files))
        for bad in ('docs', 'test', '_archive'):
            if bad in files:
                problems.append('files 里含 %s/：这些不该进发布包' % bad)
    if not d.get('scripts', {}).get('test'):
        problems.append('package.json 缺 scripts.test（别人没法验证你的代码）')


def check_readme():
    p = os.path.join(ROOT, 'README.md')
    if not os.path.isfile(p):
        problems.append('找不到 README.md')
        return
    with io.open(p, encoding='utf-8') as f:
        s = f.read()
    if '首次配置' not in s and '快速开始' not in s and '开始使用' not in s:
        problems.append('README 没有「首次配置 / 快速开始」章节：用户装上不知道填什么')
    else:
        notes.append('README 有首次配置引导')
    if '安装' not in s:
        problems.append('README 没有「安装」章节')


def check_stray_files():
    for fn in os.listdir(ROOT):
        if fn.endswith('.bak') or '.bak-' in fn:
            problems.append('根目录有备份文件 %s：发布前移进 _archive/' % fn)
    src = os.path.join(ROOT, 'src')
    if os.path.isdir(src):
        for fn in os.listdir(src):
            if '.bak' in fn:
                problems.append('src/ 里有备份 %s：会被打包出去' % fn)


def main():
    scan_sensitive()
    check_package()
    check_readme()
    check_stray_files()

    print('=' * 52)
    print('发布前自检：%s' % os.path.basename(ROOT))
    print('=' * 52)
    for n in notes:
        print('  [OK] %s' % n)
    if problems:
        print()
        for p in problems:
            print('  [!] %s' % p)
        print()
        print('结论：有 %d 个问题要修，暂不建议发布。' % len(problems))
        return 1
    print()
    print('结论：可以发。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
