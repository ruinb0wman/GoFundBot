#!/usr/bin/env python3
"""
日志 AI 分析脚本 — 读取 JSONL 日志文件，统计错误并调用 LLM 分析。
可用作模块导入 (analyze_logs(source, date)) 或 CLI 运行。
"""

import contextlib
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import get_config
from core.logging import get_log_file_path

_MAX_LOG_ENTRIES = 500
_MAX_LOG_CHARS = 50_000


def _truncate_for_llm(entries: list[dict], max_chars: int = _MAX_LOG_CHARS) -> list[dict]:
    result = []
    chars = 0
    for e in entries:
        text = json.dumps(e, ensure_ascii=False)
        if chars + len(text) > max_chars:
            break
        result.append(e)
        chars += len(text)
    return result


def analyze_logs(source: str, date_str: str) -> dict:
    file_path = get_log_file_path(source, date_str)
    if not file_path.exists():
        return {"source": source, "date": date_str, "error": "文件不存在"}

    entries = []
    with open(file_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            with contextlib.suppress(json.JSONDecodeError):
                entries.append(json.loads(line))

    total = len(entries)
    levels = {}
    errors = []
    warnings = []
    for e in entries:
        lv = e.get("level", "info").lower()
        levels[lv] = levels.get(lv, 0) + 1
        if lv == "error":
            errors.append(e)
        elif lv == "warn":
            warnings.append(e)

    result = {
        "source": source,
        "date": date_str,
        "total": total,
        "levels": levels,
        "error_count": len(errors),
        "warn_count": len(warnings),
    }

    if total == 0:
        result["summary"] = "当日无日志记录"
        return result

    cfg = get_config()
    if not cfg.llm_api_key or not cfg.llm_api_key.startswith("sk-"):
        result["summary"] = "LLM 未配置，仅提供统计"
        return result

    combined = _truncate_for_llm(errors + warnings, _MAX_LOG_CHARS)
    if not combined:
        result["summary"] = "无错误或警告日志"
        return result

    prompt = (
        f"系统日志分析报告\n"
        f"===============\n"
        f"来源: {source}\n日期: {date_str}\n总日志量: {total}\n"
        f"级别分布: {json.dumps(levels, ensure_ascii=False)}\n"
        f"错误: {len(errors)}, 警告: {len(warnings)}\n\n"
        f"错误/警告日志条目 (共 {len(combined)} 条):\n"
    )
    for i, e in enumerate(combined, 1):
        prompt += f"\n[{i}] {json.dumps(e, ensure_ascii=False)}"

    system_prompt = (
        "你是系统运维分析助手。分析下方日志，返回 JSON 格式结果：\n"
        "{\n"
        '  "patterns": ["错误模式1", "错误模式2"],\n'
        '  "suggestions": ["优化建议1", "优化建议2"],\n'
        '  "critical": ["需要立即处理的问题"]\n'
        "}\n"
        "使用中文回答，pattern 数量不超过 5 条，suggestions 不超过 5 条。"
    )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=cfg.llm_api_key, base_url=cfg.llm_api_base)
        response = client.chat.completions.create(
            model=cfg.llm_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=1024,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content
        if content:
            ai_result = json.loads(content)
            result.update(ai_result)
    except Exception as e:
        result["llm_error"] = str(e)

    return result


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="分析日志文件")
    parser.add_argument("--source", default="backend", help="日志来源 (backend/dataservice/frontend)")
    parser.add_argument("--date", default=datetime.now(UTC).strftime("%Y-%m-%d"), help="日期 YYYY-MM-DD")
    args = parser.parse_args()

    result = analyze_logs(args.source, args.date)
    print(json.dumps(result, ensure_ascii=False, indent=2))
