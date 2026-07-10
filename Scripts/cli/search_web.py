"""
Web search CLI script — called by Express chatTools via spawn.
Reads JSON from stdin: { query, max_results, bocha_key?, tavily_key? }
Outputs JSON to stdout.
"""

import json
import os
import sys


def main():
    raw = sys.stdin.read()
    try:
        inp = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        print(json.dumps({"success": False, "error": "Invalid JSON input"}, ensure_ascii=False))
        return

    query = inp.get("query", "")
    max_results = int(inp.get("max_results", 5))

    if not query:
        print(json.dumps({"success": False, "error": "query is required"}, ensure_ascii=False))
        return

    # Temporarily set API keys from input (overrides env)
    if inp.get("bocha_key"):
        os.environ["BOCHA_API_KEY"] = inp["bocha_key"]
    if inp.get("tavily_key"):
        os.environ["TAVILY_API_KEY"] = inp["tavily_key"]

    from search_service import get_search_service

    svc = get_search_service()
    response = svc.search(query, max_results=max_results)

    if response.success and response.results:
        results = [
            {
                "title": r.title,
                "snippet": r.snippet,
                "url": r.url,
                "source": r.source,
                "date": r.published_date,
            }
            for r in response.results
        ]
        print(json.dumps({
            "success": True,
            "results": results,
            "provider": response.provider,
            "search_time": response.search_time,
        }, ensure_ascii=False))
    else:
        print(json.dumps({
            "success": False,
            "results": [],
            "provider": response.provider,
            "error": response.error_message or "搜索无结果",
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
