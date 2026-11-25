# -*- coding: utf-8 -*-
"""同步 describe.json 与运行时 describe.tools。

为什么需要：Cortico 的 World 有两份「工具说明」——
  · 运行时对象：src/index.ts 里 LIVE_CUE.describe.tools（模型真正拿到的 schema）
  · 导出文件：describe.json（市场上架、给作者页看）
只改一份就会出现「日志不报警、模型却看不到参数」或者反之。这个脚本以
运行时对象为准，重新生成 describe.json；--check 只比对不写。

用法：
    python scripts/sync_describe.py          # 生成/覆盖 describe.json
    python scripts/sync_describe.py --check  # 不一致时退出码 1
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src/index.ts"
OUT = ROOT / "describe.json"


def extract_tools() -> list:
    s = SRC.read_text(encoding="utf-8")
    i = s.find("describe: {")
    if i < 0:
        raise SystemExit("找不到 describe: {")
    j = s.find("tools:", i)
    if j < 0:
        raise SystemExit("找不到 tools:")
    k = s.find("[", j)
    depth = 0
    for idx in range(k, len(s)):
        ch = s[idx]
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return json.loads(s[k:idx + 1])
    raise SystemExit("方括号没闭合")


def main() -> int:
    tools = extract_tools()
    names = [t["name"] for t in tools]
    body = {"tools": tools, "prompts": []}
    text = json.dumps(body, ensure_ascii=False, indent=2) + "\n"

    if "--check" in sys.argv:
        old = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        try:
            same = json.loads(old) == body
        except Exception:
            same = False
        print(("一致" if same else "不一致") + f"：运行时 {len(tools)} 个工具（{', '.join(names)}）")
        return 0 if same else 1

    OUT.write_text(text, encoding="utf-8")
    print(f"已写入 {OUT.name}：{len(tools)} 个工具（{', '.join(names)}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
