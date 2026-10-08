/**
 * 自动生成，请勿手改 —— 用 `bun run gen:tools`（service/scripts/gen-tools-manifest.ts）重新生成。
 *
 * service 未启动时，pi 扩展用它注册工具（否则模型连工具名都看不到，只会报「没有工具」）。
 */
export const STATIC_MANIFEST = {
  "tools": [
    {
      "name": "get_market_indices",
      "label": "获取指数行情",
      "description": "获取主要股指实时行情（上证、深证、创业板、沪深300、科创50、恒生等）。",
      "promptSnippet": "get_market_indices(): 主要指数实时行情",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "get_index_kline",
      "label": "获取指数K线",
      "description": "获取指数历史 K 线（日/周/月），用于分析历史走势、回撤幅度与修复时间。A 股用 sh/sz 前缀：sh000001（上证）、sz399001（深证）、sh000300（沪深300）、sz399006（创业板）、sh000688（科创50）；海外指数用代码且不加 ^：DJI（道琼斯）、SPX（标普500）、NDX（纳斯达克100）、HSI（恒生）、N225、FTSE、GDAXI、FCHI、SENSEX。海外指数走 Yahoo，可能较慢；其 date 字段为 YYYYMMDD。起始与结束日期必须同时提供。**A 股个股请用 `get_stock_kline`**（本工具按指数口径包装，个股也能传但不推荐）。",
      "promptSnippet": "get_index_kline(code, start_date, end_date, period?): 指数历史K线（A股 sh/sz 或海外 DJI/HSI）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "description": "指数代码：A 股 sh000300 / sz399006；海外 DJI / SPX / HSI（不要加 ^ 前缀）"
          },
          "start_date": {
            "type": "string",
            "description": "起始日期 YYYY-MM-DD（必填）"
          },
          "end_date": {
            "type": "string",
            "description": "结束日期 YYYY-MM-DD（必填）"
          },
          "period": {
            "description": "K 线周期，默认 daily",
            "type": "string",
            "enum": [
              "daily",
              "weekly",
              "monthly"
            ]
          }
        },
        "required": [
          "code",
          "start_date",
          "end_date"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_hot_sectors",
      "label": "获取行业板块",
      "description": "获取行业板块实时行情（同花顺行业分类，按涨跌幅降序）：涨跌幅、主力净流入、换手率。数据源降级时 code 可能为空串，此时成分股接口不可用。概念板块请用 get_concept_sectors。",
      "promptSnippet": "get_hot_sectors(limit?): 行业板块实时行情",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "description": "返回板块数量，默认 10，最大 120",
            "type": "integer",
            "minimum": 1,
            "maximum": 120
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "get_concept_sectors",
      "label": "获取概念板块",
      "description": "获取概念板块行情（同花顺资金流，按当日涨跌幅降序）：板块涨跌幅、主力净流入、成分股数量、领涨股，以及同花顺概念简介的驱动事件 event。注意 event_date 是数据源标注的事件日期，可能早于当日，不要当作行情日期；data_status 为 unavailable 时不要编造概念板块表现。",
      "promptSnippet": "get_concept_sectors(limit?): 概念板块行情（涨跌幅/净流入/驱动事件）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "description": "返回板块数量，默认 10，最大 50",
            "type": "integer",
            "minimum": 1,
            "maximum": 120
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "get_north_flow",
      "label": "获取北向资金",
      "description": "获取北向资金数据。注意：自 2024-08-19 起沪深港通不再披露北向资金净流入，data_status 恒为 unavailable，*_net_inflow 恒为 null；可用的是当日成交总额（*_deal_amount_yi，单位亿元）。必须先阅读 note 字段再作答，不要把 null 解读为 0。",
      "promptSnippet": "get_north_flow(): 北向资金成交总额（净流入已停止披露）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "get_market_breadth",
      "label": "获取涨跌统计",
      "description": "获取市场涨跌统计：沪深两市合计的上涨/下跌/平盘家数（scope 字段标注口径），以及涨停/跌停家数（limit_up/limit_down 可能为 null，不代表 0）。",
      "promptSnippet": "get_market_breadth(): 沪深两市涨跌家数 + 涨跌停家数",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "get_main_flow",
      "label": "获取主力资金",
      "description": "获取沪深两市主力资金流向（超大单/大单/中单/小单净流入）。必须检查 data_status，unavailable 时不要编造数值。",
      "promptSnippet": "get_main_flow(): 主力资金分单规模净流入",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "get_gold_realtime",
      "label": "获取贵金属报价",
      "description": "获取贵金属实时报价（黄金 T+D、国际黄金、国际白银）：最新价、涨跌额、涨跌幅、开高低收、单位。",
      "promptSnippet": "get_gold_realtime(): 贵金属实时报价",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "get_stock_kline",
      "label": "个股K线",
      "description": "获取 A 股个股历史 K 线（日/周/月，可选前/后复权）：涨跌幅、开高低收、成交量额。代码写 `sh600519` / `sz000001`，或直接写 6 位代码（自动补前缀）。指数走势用 `get_index_kline`；海外/加密标的也能传，但本工具按 A 股口径描述。",
      "promptSnippet": "get_stock_kline(code, start_date, end_date, period?, adjust?): 个股K线",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "description": "A 股代码：sh600519 / sz000001 / 600519"
          },
          "start_date": {
            "type": "string",
            "description": "起始日期 YYYY-MM-DD（必填）"
          },
          "end_date": {
            "type": "string",
            "description": "结束日期 YYYY-MM-DD（必填）"
          },
          "period": {
            "description": "K 线周期，默认 daily",
            "type": "string",
            "enum": [
              "daily",
              "weekly",
              "monthly"
            ]
          },
          "adjust": {
            "description": "复权：none 不复权 / qfq 前复权 / hfq 后复权（默认 none）",
            "type": "string",
            "enum": [
              "none",
              "qfq",
              "hfq"
            ]
          }
        },
        "required": [
          "code",
          "start_date",
          "end_date"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_a_volume_7days",
      "label": "近7日A股成交量",
      "description": "获取沪深两市最近 7 个交易日的成交额（亿元）。**必须看 `success`**：取不到数据时 `success: false` 且 `data: []`，不要把它当成「成交额 0」。指数 K 线失败也会导致这里为空。",
      "promptSnippet": "get_a_volume_7days(): 近7日A股成交额",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "get_sector_constituents",
      "label": "板块成分股",
      "description": "获取某个行业板块的成分股列表（代码、名称、涨跌幅、成交额等）。`sector_code` 来自 `get_hot_sectors`。**两个已知限制**：① 行业板块走同花顺降级时 `code` 是空串，此时无法使用；② 上游是 eastmoney 的板块成分股接口，被反爬封锁时整条链路不可用（返回 `PROVIDER_UNAVAILABLE`）——遇到这两种情况就如实告知用户，**不要编造成分股**。",
      "promptSnippet": "get_sector_constituents(sector_code): 板块成分股",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "sector_code": {
            "type": "string",
            "minLength": 1,
            "description": "板块代码（来自 get_hot_sectors 的 code；空串表示该数据源不支持）"
          }
        },
        "required": [
          "sector_code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "search_funds",
      "label": "搜索基金",
      "description": "按名称或代码关键字搜索基金，返回代码、名称、类型。",
      "promptSnippet": "search_funds(keyword): 按名称/代码关键字搜索基金",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "keyword": {
            "type": "string",
            "description": "基金名称或代码关键字"
          }
        },
        "required": [
          "keyword"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_fund_detail",
      "label": "获取基金详情",
      "description": "获取单只基金的完整详情：净值走势、区间收益、同类排名、基金经理、重仓股、资产配置、持有人结构、规模变动、申赎信息、业绩评价。结果较大，只需要净值序列时改用 get_fund_nav_history。",
      "promptSnippet": "get_fund_detail(code): 完整基金详情（业绩/持仓/经理/配置）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码，例如 110022"
          }
        },
        "required": [
          "code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_fund_estimate",
      "label": "获取基金估值",
      "description": "获取基金盘中实时估值（估算净值、估算涨跌幅、估算时间）与最近单位净值。",
      "promptSnippet": "get_fund_estimate(code): 盘中实时估值",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码，例如 110022"
          }
        },
        "required": [
          "code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_fund_nav_history",
      "label": "获取净值历史",
      "description": "获取基金历史净值序列（单位净值、累计净值）。可用于计算回撤、波动、区间收益。",
      "promptSnippet": "get_fund_nav_history(code, start_date?, end_date?): 历史净值",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码，例如 110022"
          },
          "start_date": {
            "description": "起始日期 YYYY-MM-DD（可选）",
            "type": "string"
          },
          "end_date": {
            "description": "结束日期 YYYY-MM-DD（可选）",
            "type": "string"
          }
        },
        "required": [
          "code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_fund_holdings",
      "label": "获取基金重仓股",
      "description": "获取基金重仓持股列表（股票代码、名称、占净值比例）。",
      "promptSnippet": "get_fund_holdings(code): 重仓持股",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码，例如 110022"
          }
        },
        "required": [
          "code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_fund_managers",
      "label": "获取基金经理",
      "description": "获取基金经理信息（从业年限、管理规模、任职时间、能力评估、历史业绩）。",
      "promptSnippet": "get_fund_managers(code): 基金经理信息",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码，例如 110022"
          }
        },
        "required": [
          "code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_flash_news",
      "label": "获取快讯新闻",
      "description": "获取市场 7×24 快讯（多数据源合并去重后的今日实时消息）。",
      "promptSnippet": "get_flash_news(count?): 今日 7×24 快讯",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "count": {
            "description": "新闻条数，默认 20，最大 300",
            "type": "integer",
            "minimum": 1,
            "maximum": 300
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "get_fund_estimates",
      "label": "批量基金估值",
      "description": "一次拿多只基金的盘中实时估值（估算净值/估算涨跌幅/最近公布净值与日期）。逐只查 `get_fund_estimate` 很慢（每只一次网络请求），看一批自选/持仓时用这个。取不到的单只会带 `success: false` 与错误信息，不要当成净值 0。",
      "promptSnippet": "get_fund_estimates(fund_codes): 批量盘中估值（≤50 只）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_codes": {
            "minItems": 1,
            "maxItems": 50,
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\d{6}$",
              "description": "6 位基金代码，例如 110022"
            },
            "description": "基金代码列表（≤50 只；逐只并发取数，列表越长越慢）"
          }
        },
        "required": [
          "fund_codes"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_watchlist",
      "label": "读取自选",
      "description": "读取用户的自选基金列表与分组（service SQLite，前端「我的自选」页同源）。返回 items（fundCode/fundName/fundType/groupId/sortOrder）与 groups。",
      "promptSnippet": "get_watchlist(): 用户自选基金与分组",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "add_to_watchlist",
      "label": "加入自选",
      "description": "把一只基金加入用户自选（写 service SQLite，前端「我的自选」页可见；已存在则更新名称/分组）。**这是写操作，会改用户的真实自选**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，必须先把要加的基金给用户看过并取得同意，再带上 __confirm_token 重调。",
      "promptSnippet": "add_to_watchlist(fund_code, group_id?): 加入自选（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码"
          },
          "group_id": {
            "description": "自选分组 id（来自 get_watchlist）；不填则未分组",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "fund_name": {
            "description": "基金名称（不填则自动从数据源补全）",
            "type": "string"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "remove_from_watchlist",
      "label": "移出自选",
      "description": "把一只或多只基金移出用户自选（破坏性写入，前端「我的自选」页同步消失）。**这是写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "remove_from_watchlist(fund_codes): 移出自选（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_codes": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\d{6}$",
              "description": "6 位基金代码"
            },
            "description": "要移出的基金代码列表"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_codes"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "save_watchlist_group",
      "label": "新建/重命名自选分组",
      "description": "新建一个自选分组，或重命名已有的（写 service SQLite，前端「我的自选」页可见）。不传 id = 新建（需 name）；传 id = 重命名。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "save_watchlist_group(name, id?): 新建/重命名自选分组（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "description": "要重命名的分组 id（来自 get_watchlist）；不填则新建",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 30,
            "description": "分组名"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "name"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "delete_watchlist_group",
      "label": "删除自选分组",
      "description": "删除一个自选分组（组内基金回到「未分组」，不会被删掉）。**破坏性写入**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "delete_watchlist_group(id): 删除自选分组（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "要删除的分组 id（来自 get_watchlist）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "assign_watchlist_group",
      "label": "自选基金分组",
      "description": "把一批自选基金移到某个分组（`group_id` 传 null = 取消分组）。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "assign_watchlist_group(fund_codes, group_id?): 自选基金分组（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_codes": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\d{6}$",
              "description": "6 位基金代码"
            },
            "description": "要分组的自选基金代码"
          },
          "group_id": {
            "description": "目标分组 id；null / 不填 = 取消分组",
            "anyOf": [
              {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_codes"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "reorder_watchlist",
      "label": "自选排序",
      "description": "按给定顺序重排自选列表（传入的代码顺序就是新的显示顺序；未列出的基金排在后面）。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "reorder_watchlist(fund_codes): 自选排序（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_codes": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\d{6}$",
              "description": "6 位基金代码"
            },
            "description": "新的顺序（代码列表）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_codes"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_alerts",
      "label": "读取告警规则",
      "description": "读取用户的基金告警规则（fund_code/alert_type/threshold/enabled/last_triggered）与市场异动阈值配置。`price_*` 比的是实时估算涨跌幅，`return_*` 比的是**持仓收益率**（持仓由已结算交易推导，没持仓的基金不会触发）。",
      "promptSnippet": "get_alerts(): 告警规则 + 异动阈值",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "save_alert",
      "label": "保存告警规则",
      "description": "新建或更新一条基金告警规则（写 service SQLite，前端「告警设置」里可见）。不传 id = 新建（需要 fund_code + alert_type）；传 id = 更新（改 threshold / enabled）。**这是写操作，会改用户的真实告警**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，必须先把要写的规则给用户看过并取得同意，再带上 __confirm_token 重调。",
      "promptSnippet": "save_alert(fund_code, alert_type, threshold, id?, enabled?): 新建/更新告警（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "description": "要更新的规则 id（来自 get_alerts）；不填则新建",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "fund_code": {
            "description": "基金代码（新建时必填，更新时忽略）",
            "type": "string",
            "pattern": "^\\d{6}$"
          },
          "alert_type": {
            "description": "告警类型（新建时必填，更新时忽略）",
            "type": "string",
            "enum": [
              "price_up",
              "price_down",
              "return_above",
              "return_below"
            ]
          },
          "threshold": {
            "type": "number",
            "exclusiveMinimum": 0,
            "description": "阈值，百分数（5 = 5%）。price_down 用正数表示跌幅（3 = 跌超 3%）"
          },
          "enabled": {
            "description": "是否启用（更新时用；新建默认启用）",
            "type": "boolean"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "threshold"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "delete_alert",
      "label": "删除告警规则",
      "description": "删除一条基金告警规则（破坏性写入，前端「告警设置」里同步消失）。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "delete_alert(id): 删除告警规则（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "要删除的规则 id（来自 get_alerts）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "check_alerts",
      "label": "立即检查告警",
      "description": "立刻评估一遍所有启用的告警规则，返回命中的规则（含当前值与阈值）。**副作用**：命中的规则会写 last_triggered 并进入 **6 小时冷却**（冷却期内不再重复报）—— 这是通知去抖，不是数据修改。",
      "promptSnippet": "check_alerts(): 立即评估告警规则（命中后 6h 冷却）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "get_market_anomaly",
      "label": "市场异动",
      "description": "按当前异动阈值检测当日市场异动：指数大涨/大跌、板块大涨/大跌、两市成交额放量/缩量。返回 anomalies（type/name/value）、indices 行情与当前阈值。注意：`north_*` 阈值没有数据可判（北向净流入自 2024-08 起停止披露）。",
      "promptSnippet": "get_market_anomaly(): 当日市场异动（指数/板块/成交额）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "save_anomaly_config",
      "label": "保存异动阈值",
      "description": "更新市场异动的判定阈值（前端「设置 → 异动阈值」同一份配置，落 SQLite）。只传要改的字段，其余保持不动。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "save_anomaly_config(index_surge_threshold?, …): 改异动阈值（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "index_surge_threshold": {
            "description": "指数大涨阈值（%，默认 3）",
            "type": "number"
          },
          "index_plunge_threshold": {
            "description": "指数大跌阈值（%，默认 -3）",
            "type": "number"
          },
          "volume_surge_ratio": {
            "description": "成交额放量倍数（默认 1.5）",
            "type": "number"
          },
          "volume_shrink_ratio": {
            "description": "成交额缩量倍数（默认 0.5）",
            "type": "number"
          },
          "sector_surge_threshold": {
            "description": "板块大涨阈值（%，默认 5）",
            "type": "number"
          },
          "sector_plunge_threshold": {
            "description": "板块大跌阈值（%，默认 -5）",
            "type": "number"
          },
          "sector_inflow_threshold": {
            "description": "板块主力净流入阈值（亿元，默认 10）",
            "type": "number"
          },
          "north_inflow_threshold": {
            "description": "北向流入阈值（暂无数据可判）",
            "type": "number"
          },
          "north_outflow_threshold": {
            "description": "北向流出阈值（暂无数据可判）",
            "type": "number"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "get_portfolio",
      "label": "读取实时组合",
      "description": "一次性读取实时页的组合数据：组合基金列表（funds）、分组（groups，含再平衡配置）、基金↔分组映射（fund_group_map）与**推导出来的持仓**（holdings，按基金代码索引：share/cost/total_fee/buy_date）。持仓只由已结算交易推导 —— 想让某只基金出现在持仓里，得先 add_trade。",
      "promptSnippet": "get_portfolio(): 组合基金 + 分组 + 映射 + 推导持仓",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "add_portfolio_fund",
      "label": "加入实时组合",
      "description": "把一只基金加入实时页的组合列表（写 service SQLite，前端「实时估值」标签可见；已在列表里则只更新名称/类型）。注意这与自选（watchlist）是**两个不同的列表**。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "add_portfolio_fund(fund_code, group_id?): 加入实时组合（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码"
          },
          "group_id": {
            "description": "顺带分到哪个分组（来自 get_portfolio.groups）",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "fund_name": {
            "description": "基金名称（不填则自动从数据源补全）",
            "type": "string"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "remove_portfolio_fund",
      "label": "移出实时组合",
      "description": "把一只基金移出实时页的组合列表（同时清掉它的分组映射；**不会**删交易记录/持仓）。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "remove_portfolio_fund(fund_code): 移出实时组合（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "save_portfolio_group",
      "label": "保存组合分组",
      "description": "新建或更新一个组合分组（实时页的「分组」；可带再平衡配置：enabled/target/upper/lower，都是百分数）。不传 id = 新建（需 name）；传 id = 更新（只改传入的字段）。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "save_portfolio_group(name, id?, rebalance_*?): 新建/更新分组（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "description": "要更新的分组 id（来自 get_portfolio.groups）；不填则新建",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "name": {
            "description": "分组名（新建必填）",
            "type": "string",
            "minLength": 1,
            "maxLength": 40
          },
          "rebalance_enabled": {
            "description": "是否启用再平衡",
            "type": "boolean"
          },
          "rebalance_target": {
            "description": "目标仓位（%，如 60）",
            "type": [
              "number",
              "null"
            ]
          },
          "rebalance_upper": {
            "description": "上界（%，如 70）",
            "type": [
              "number",
              "null"
            ]
          },
          "rebalance_lower": {
            "description": "下界（%，如 50）",
            "type": [
              "number",
              "null"
            ]
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "delete_portfolio_group",
      "label": "删除组合分组",
      "description": "删除一个组合分组（组内基金的映射随外键级联删除，基金本身回到「未分组」）。**破坏性写入**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "delete_portfolio_group(id): 删除分组（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "要删除的分组 id（来自 get_portfolio.groups）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "assign_funds_to_group",
      "label": "基金分组",
      "description": "把一批基金移到某个分组（`group_id` 传 null = 取消分组）。只影响这几只基金，其余映射保持不变。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "assign_funds_to_group(fund_codes, group_id?): 基金分组（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_codes": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "string",
              "pattern": "^\\d{6}$",
              "description": "6 位基金代码"
            },
            "description": "要分组的基金代码列表"
          },
          "group_id": {
            "description": "目标分组 id；null / 不传 = 取消分组",
            "anyOf": [
              {
                "type": "integer",
                "exclusiveMinimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_codes"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "add_trade",
      "label": "记录一笔交易",
      "description": "给实时页记录一笔交易（写 service SQLite，前端「实时估值」/基金详情的交易记录可见，并会改变推导持仓）。金额/份额可以只传一个，工具会按净值换算：`buy` 只需 amount + nav（share = amount / nav）；`sell` 只需 share + nav（amount = share × nav）；`dividend` 分红再投传 share（或 amount + nav）；`fee` 手续费传 amount。当天净值还没出来的交易传 status=\"pending\"，之后用 settle_trades 结算。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "add_trade(fund_code, type, trade_date, amount|share, nav, status?): 记一笔交易（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码"
          },
          "type": {
            "type": "string",
            "enum": [
              "buy",
              "sell",
              "dividend",
              "fee"
            ],
            "description": "交易类型（buy 买 / sell 卖 / dividend 分红再投 / fee 手续费）"
          },
          "trade_date": {
            "type": "string",
            "description": "交易日期 YYYY-MM-DD"
          },
          "amount": {
            "description": "金额（元）：buy/fee 传它；sell 不传则由 share × nav 算",
            "type": "number",
            "minimum": 0
          },
          "share": {
            "description": "份额：sell/dividend 传它；buy 不传则由 amount / nav 算",
            "type": "number",
            "minimum": 0
          },
          "nav": {
            "description": "成交净值（buy/sell 必需；fee 可省）",
            "type": "number",
            "minimum": 0
          },
          "status": {
            "description": "默认 settled；当天净值未出时用 pending",
            "type": "string",
            "enum": [
              "settled",
              "pending"
            ]
          },
          "txn_id": {
            "description": "挂单号（pending 交易用它结算；不填则自动生成）",
            "type": "string"
          },
          "note": {
            "description": "备注",
            "type": "string"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_code",
          "type",
          "trade_date"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "settle_trades",
      "label": "结算挂单交易",
      "description": "把 pending 的交易按 txn_id 结算（status → settled，写入 settled_at），结算后这些交易开始计入推导持仓。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "settle_trades(txn_ids): 结算挂单交易（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "txn_ids": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            },
            "description": "要结算的挂单号列表（来自 get_portfolio / 交易记录的 txn_id）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "txn_ids"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "delete_trade",
      "label": "删除交易记录",
      "description": "删除一条交易记录（会改变推导持仓；要清空全部请让用户在页面上操作）。**破坏性写入**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "delete_trade(id): 删除交易记录（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "交易记录 id（来自 get_portfolio 或 GET /api/user/portfolio/trades）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "get_positions",
      "label": "读取持仓",
      "description": "读取用户在「持仓管理」里录入的实际持仓（基金代码、份额、成本、买入日期），用于持仓诊断与收益核对。这是**手工录入**的持仓；实时页那份由已结算交易推导的持仓见 `get_portfolio`。",
      "promptSnippet": "get_positions(): 用户手工录入的持仓列表",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "add_position",
      "label": "新增持仓",
      "description": "新增一条持仓记录（写 service SQLite，前端「持仓管理」页可见）。份额 share 与成本价 cost 都是必填；基金名称不填会自动补全。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，必须先把要记的持仓给用户看过并取得同意，再带上 __confirm_token 重调。",
      "promptSnippet": "add_position(fund_code, shares, cost, purchase_date?): 新增持仓（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码"
          },
          "shares": {
            "type": "number",
            "exclusiveMinimum": 0,
            "description": "持有份额"
          },
          "cost": {
            "type": "number",
            "exclusiveMinimum": 0,
            "description": "成本单价（每份成本，元）"
          },
          "fund_name": {
            "description": "基金名称（不填则自动补全）",
            "type": "string"
          },
          "purchase_date": {
            "description": "买入日期 YYYY-MM-DD",
            "type": "string"
          },
          "purchase_time": {
            "description": "买入时间 HH:MM",
            "type": "string"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "fund_code",
          "shares",
          "cost"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "update_position",
      "label": "修改持仓",
      "description": "修改一条持仓记录（只改传入的字段，其余不动）。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "update_position(id, shares?, cost?, fund_name?, purchase_date?): 修改持仓（需确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "持仓 id（来自 get_positions）"
          },
          "shares": {
            "description": "新的持有份额",
            "type": "number",
            "exclusiveMinimum": 0
          },
          "cost": {
            "description": "新的成本单价",
            "type": "number",
            "exclusiveMinimum": 0
          },
          "fund_name": {
            "description": "基金名称",
            "type": "string"
          },
          "purchase_date": {
            "description": "买入日期 YYYY-MM-DD（null 清空）",
            "type": [
              "string",
              "null"
            ]
          },
          "purchase_time": {
            "description": "买入时间 HH:MM（null 清空）",
            "type": [
              "string",
              "null"
            ]
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "delete_position",
      "label": "删除持仓",
      "description": "删除一条持仓记录（破坏性写入，前端「持仓管理」页同步消失）。**写操作**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "delete_position(id): 删除持仓（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "持仓 id（来自 get_positions）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "run_backtest",
      "label": "基金定投回测",
      "description": "对单只基金做定投/价值平均/均线偏离回测，返回投入、市值、收益率、年化、最大回撤、夏普与抽样净值曲线。间隔用 investment_type（daily/weekly/monthly）+ day 指定。费率、止盈止损用小数（0.2 = 20%）。不传日期默认最近三年。",
      "promptSnippet": "run_backtest(fund_code, ...): 单基金定投回测（月投/周投/价值平均/均线偏离）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码"
          },
          "start_date": {
            "description": "起始日期 YYYY-MM-DD，默认三年前",
            "type": "string"
          },
          "end_date": {
            "description": "结束日期 YYYY-MM-DD，默认今天",
            "type": "string"
          },
          "amount": {
            "description": "每期投入金额（元），默认 1000",
            "type": "number",
            "exclusiveMinimum": 0
          },
          "initial_amount": {
            "description": "期初一次性投入（元）",
            "type": "number",
            "minimum": 0
          },
          "fee_rate": {
            "description": "手续费率，小数（0.0015 = 0.15%），默认 0.0015",
            "type": "number"
          },
          "take_profit_rate": {
            "description": "止盈阈值，小数（0.2 = 20%）",
            "type": [
              "number",
              "null"
            ]
          },
          "stop_loss_rate": {
            "description": "止损阈值，小数（负数，-0.15 = -15%）",
            "type": [
              "number",
              "null"
            ]
          },
          "investment_type": {
            "description": "定投频率：daily 每日 / weekly 每周 / monthly 每月（默认 monthly）",
            "type": "string",
            "enum": [
              "daily",
              "weekly",
              "monthly"
            ]
          },
          "day": {
            "description": "每月/每周的定投日序号",
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 31
              },
              {
                "type": "null"
              }
            ]
          },
          "dca_rule": {
            "description": "定投规则：equal 等额 / value_averaging 价值平均",
            "type": "string",
            "enum": [
              "equal",
              "value_averaging"
            ]
          },
          "target_growth": {
            "description": "价值平均的目标增长率（小数，0.01 = 每月市值增长 1%）",
            "type": "number"
          },
          "ma_window": {
            "description": "均线偏离策略的均线天数（如 250）",
            "type": "integer",
            "minimum": 2,
            "maximum": 400
          },
          "ma_factor": {
            "description": "均线偏离策略的加码倍数（小数，0.5 = 偏离时多投 50%）",
            "type": "number"
          }
        },
        "required": [
          "fund_code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "run_portfolio_backtest",
      "label": "组合回测",
      "description": "多资产组合回测：资产权重 + 可选定期注水 + 日历/阈值再平衡 + 现金腿（资产不填 fund_code 即现金），返回 TWR 年化、最大回撤、各腿期末权重与抽样净值曲线。",
      "promptSnippet": "run_portfolio_backtest(assets, ...): 组合回测（权重/再平衡/注水/现金腿）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "assets": {
            "minItems": 1,
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "fund_code": {
                  "description": "基金代码；不填则该腿是现金",
                  "type": "string",
                  "pattern": "^\\d{6}$"
                },
                "weight": {
                  "type": "number",
                  "exclusiveMinimum": 0,
                  "description": "权重（小数 0.6 或百分数 60 都行，同一次调用保持一致）"
                },
                "annual_rate": {
                  "description": "现金腿的年化收益率（小数，0.02 = 2%）",
                  "type": "number"
                },
                "name": {
                  "type": "string"
                }
              },
              "required": [
                "weight"
              ],
              "additionalProperties": false
            },
            "description": "资产列表（至少 1 个；不含 fund_code 的腿按现金处理）"
          },
          "start_date": {
            "description": "起始日期 YYYY-MM-DD，默认三年前",
            "type": "string"
          },
          "end_date": {
            "description": "结束日期 YYYY-MM-DD，默认今天",
            "type": "string"
          },
          "initial_amount": {
            "description": "期初投入（元）",
            "type": "number",
            "exclusiveMinimum": 0
          },
          "contribution_amount": {
            "description": "定期注水金额（元）",
            "type": "number",
            "exclusiveMinimum": 0
          },
          "contribution_period": {
            "description": "注水频率",
            "type": "string",
            "enum": [
              "monthly",
              "quarterly",
              "yearly"
            ]
          },
          "rebalance_frequency": {
            "description": "再平衡频率，默认 none",
            "type": "string",
            "enum": [
              "none",
              "monthly",
              "quarterly",
              "yearly"
            ]
          },
          "rebalance_threshold": {
            "description": "阈值再平衡的偏离阈值（小数，0.05 = 5%）",
            "type": "number"
          },
          "fee_rate": {
            "description": "手续费率（小数），默认 0.0015",
            "type": "number"
          }
        },
        "required": [
          "assets"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "compare_backtest_strategies",
      "label": "对比回测策略",
      "description": "对同一只基金跑多种定投策略（每日/每周/每月/价值平均/均线偏离/一次性）并给出推荐与理由。",
      "promptSnippet": "compare_backtest_strategies(fund_code, ...): 多策略对比 + 推荐",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "fund_code": {
            "type": "string",
            "pattern": "^\\d{6}$",
            "description": "6 位基金代码"
          },
          "start_date": {
            "description": "起始日期 YYYY-MM-DD，默认三年前",
            "type": "string"
          },
          "end_date": {
            "description": "结束日期 YYYY-MM-DD，默认今天",
            "type": "string"
          },
          "amount": {
            "description": "每期投入金额（元），默认 1000",
            "type": "number",
            "exclusiveMinimum": 0
          },
          "initial_amount": {
            "description": "期初一次性投入（元）",
            "type": "number",
            "minimum": 0
          },
          "fee_rate": {
            "description": "手续费率，小数（0.0015 = 0.15%），默认 0.0015",
            "type": "number"
          },
          "take_profit_rate": {
            "description": "止盈阈值，小数（0.2 = 20%）",
            "type": [
              "number",
              "null"
            ]
          },
          "stop_loss_rate": {
            "description": "止损阈值，小数（负数，-0.15 = -15%）",
            "type": [
              "number",
              "null"
            ]
          },
          "investment_type": {
            "description": "定投频率：daily 每日 / weekly 每周 / monthly 每月（默认 monthly）",
            "type": "string",
            "enum": [
              "daily",
              "weekly",
              "monthly"
            ]
          },
          "day": {
            "description": "每月/每周的定投日序号",
            "anyOf": [
              {
                "type": "integer",
                "minimum": 1,
                "maximum": 31
              },
              {
                "type": "null"
              }
            ]
          },
          "dca_rule": {
            "description": "定投规则：equal 等额 / value_averaging 价值平均",
            "type": "string",
            "enum": [
              "equal",
              "value_averaging"
            ]
          },
          "target_growth": {
            "description": "价值平均的目标增长率（小数，0.01 = 每月市值增长 1%）",
            "type": "number"
          },
          "ma_window": {
            "description": "均线偏离策略的均线天数（如 250）",
            "type": "integer",
            "minimum": 2,
            "maximum": 400
          },
          "ma_factor": {
            "description": "均线偏离策略的加码倍数（小数，0.5 = 偏离时多投 50%）",
            "type": "number"
          }
        },
        "required": [
          "fund_code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "screen_funds",
      "label": "筛选基金",
      "description": "在本地基金库（约 3300 只，含风险指标/行业标签/4433 排名）里筛选、排序、分页。数据由 service 维护，先看 get_screening_status 了解富化覆盖度；没有风险指标的基金其 sharpe_ratio_1y 为 null。",
      "promptSnippet": "screen_funds(filters, sort_by?, ...): 基金筛选（4433/行业/收益/回撤/夏普）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "filters": {
            "type": "object",
            "properties": {
              "fund_types": {
                "description": "基金类型（精确匹配 fund_type）",
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "industry_tags": {
                "description": "行业标签（如 医药医疗 / 科技 / 固收）",
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "pass_4433": {
                "description": "只看通过 4433 法则的基金",
                "type": "boolean"
              },
              "keyword": {
                "description": "基金代码或名称关键字",
                "type": "string"
              },
              "return_1y_min": {
                "type": "number"
              },
              "return_1y_max": {
                "type": "number"
              },
              "return_3y_min": {
                "type": "number"
              },
              "return_3y_max": {
                "type": "number"
              },
              "sharpe_ratio_1y_min": {
                "description": "近一年夏普下限（先做筛选富化才有值）",
                "type": "number"
              },
              "calmar_ratio_1y_min": {
                "type": "number"
              },
              "max_drawdown_1y_max": {
                "description": "近一年最大回撤上限（负数，如 -10 表示不超过 -10%）",
                "type": "number"
              },
              "volatility_1y_max": {
                "type": "number"
              },
              "rank_pct_1y_max": {
                "description": "近一年同类排名百分位上限（25 = 前 25%）",
                "type": "number"
              }
            },
            "additionalProperties": false
          },
          "sort_by": {
            "description": "排序字段，默认 return_1y（常用 sharpe_ratio_1y / max_drawdown_1y / return_3m）",
            "type": "string"
          },
          "sort_order": {
            "description": "排序方向，默认 desc",
            "type": "string",
            "enum": [
              "asc",
              "desc"
            ]
          },
          "page": {
            "description": "页码，默认 1",
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "page_size": {
            "description": "每页条数，默认 20",
            "type": "integer",
            "minimum": 1,
            "maximum": 200
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "get_screening_status",
      "label": "筛选数据状态",
      "description": "查询基金筛选库的状态：总数、已算风险指标数、待富化数、4433 通过数、类型分布与最近同步时间。看到 risk_metrics_pending > 0 时说明部分基金还没有夏普/回撤值（需要先富化）。",
      "promptSnippet": "get_screening_status(): 筛选库覆盖度与同步时间",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "refresh_screening",
      "label": "刷新筛选库",
      "description": "刷新本地基金筛选库：拉最新快照 + 重算 4433 排名，并可选跑一批风险指标富化（夏普/回撤等）。会联网刷新（只写缓存，不动用户数据），冷启动全量约 3 分钟，所以默认只做一批（enrich_limit，300 只）；返回后看 risk_metrics_pending，>0 就再调一次。retry=true 会把上次取数失败的基金重新标记为待算。",
      "promptSnippet": "refresh_screening(force?, enrich_limit?, retry?): 刷新筛选库/富化风险指标",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "force": {
            "description": "true = 忽略快照时间，强制重新同步（默认 false，快照没变就跳过）",
            "type": "boolean"
          },
          "enrich_limit": {
            "description": "本批富化多少只基金，默认 300；0 = 只同步排名不富化",
            "type": "integer",
            "minimum": 0,
            "maximum": 2000
          },
          "retry": {
            "description": "true = 重试上次取不到净值的基金（risk_attempted 归零）",
            "type": "boolean"
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "get_research_dashboard",
      "label": "投研看板",
      "description": "一次性拿到投研看板的四个板块：基金市场统计（总数/风险指标覆盖/4433 通过率/收益中位数）、基金看板（各类型数量与中位收益）、ETF 每日跟踪、行业表现。比自己去 screen_funds 逐项统计更省事，数字与前端 /research 页面一致。",
      "promptSnippet": "get_research_dashboard(limit?): 投研看板（市场统计/基金看板/ETF/行业表现）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {
          "limit": {
            "description": "每个榜单取前几名，默认 5",
            "type": "integer",
            "minimum": 1,
            "maximum": 50
          },
          "etf_limit": {
            "description": "ETF 明细取多少行（默认 10；明细已默认精简）",
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          },
          "include_items": {
            "description": "true = 返回完整看板（含每张卡片的 top 基金与全部 ETF 行，可能超长被截断）",
            "type": "boolean"
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "list_strategies",
      "label": "读取策略记忆",
      "description": "读取用户在 GoFundBot「策略研究」里保存的投资策略（标题、正文、标签、是否启用）。需要结合用户策略分析持仓/基金时先读它。",
      "promptSnippet": "list_strategies(): 用户的策略记忆（投资目标/纪律）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "save_strategy",
      "label": "写入策略记忆",
      "description": "保存或更新一条策略记忆（写入 service SQLite，前端 /strategy 页面可见）。**这是写操作**：必须先把内容给用户看过并得到明确同意；第一次调用只会返回 CONFIRM_REQUIRED 与确认令牌，带上该令牌再调一次才真正写入。",
      "promptSnippet": "save_strategy(title, content, tags?, active?, id?): 写入策略记忆（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "description": "要更新的策略 id（来自 list_strategies）；不填则新建",
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991
          },
          "title": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40,
            "description": "策略标题（≤40 字）"
          },
          "content": {
            "type": "string",
            "minLength": 1,
            "description": "策略正文：投资目标、资金分配、买卖纪律、风险管理"
          },
          "tags": {
            "description": "标签，例如 [\"定投\", \"长期持有\"]",
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "active": {
            "description": "是否启用（启用的策略会注入 AI 提示词），默认 true",
            "type": "boolean"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "title",
          "content"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "delete_strategy",
      "label": "删除策略记忆",
      "description": "删除一条策略记忆（前端 /strategy 页面同步消失）。**破坏性写入**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，必须先把要删的标题给用户看过并取得明确同意，再带 __confirm_token 重调。",
      "promptSnippet": "delete_strategy(id): 删除策略记忆（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "要删除的策略 id（来自 list_strategies）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "list_strategy_scripts",
      "label": "列出已保存的回测方案",
      "description": "列出用户保存的「策略代码」回测方案（名称、代码、上次运行结果）。要用某个方案回测时，把它的名称传给 run_strategy_code 的 script_name（比让模型重新生成代码更省事）。",
      "promptSnippet": "list_strategy_scripts(): 已保存的回测方案（名称/代码/上次结果）",
      "readOnly": true,
      "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": false
      }
    },
    {
      "name": "run_strategy_code",
      "label": "代码回测（自由策略）",
      "description": "执行一段「自由策略代码」并回测：代码是模块，`prepare(sdk)` 声明固定标的池（`sdk.screen()` 可筛本地基金库），`onDay(s)` 逐日返回 { buy|sell|rebalance|sellAll }（按基金代码）。返回抽样后的组合结果（投入/市值/收益率/TWR/回撤/各腿权重 + 少量 checkpoint），与页面 /backtest 同源同值。**这是执行类操作**：代码在隔离 worker 里跑（5s 超时、无网络），但仍需用户确认 —— 第一次调用返回 CONFIRM_REQUIRED 与令牌，先把代码给用户看并取得同意，再用同样参数 + 令牌重调。",
      "promptSnippet": "run_strategy_code(code|script_name, ...): 跑自由策略代码回测（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "code": {
            "description": "策略代码（与 script_name 二选一）",
            "type": "string"
          },
          "script_name": {
            "description": "已保存方案的名称（与 code 二选一，见 list_strategy_scripts）",
            "type": "string"
          },
          "start_date": {
            "description": "覆盖方案声明的开始日期 YYYY-MM-DD",
            "type": "string"
          },
          "end_date": {
            "description": "覆盖方案声明的结束日期 YYYY-MM-DD",
            "type": "string"
          },
          "initial_amount": {
            "description": "覆盖期初投入（元）",
            "type": "number",
            "minimum": 0
          },
          "fee_rate": {
            "description": "覆盖手续费率（小数，0.0015 = 0.15%）",
            "type": "number"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    {
      "name": "save_strategy_script",
      "label": "保存回测方案",
      "description": "把一段策略代码存成命名方案（写 service SQLite，前端 /backtest 页面可见，之后可用 `run_strategy_code(script_name=...)` 重跑）。**写操作**：第一次调用返回 CONFIRM_REQUIRED 与令牌，用户确认后用同样参数 + 令牌重调。",
      "promptSnippet": "save_strategy_script(name, code): 保存回测方案（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 60,
            "description": "方案名（唯一，页面下拉里显示）"
          },
          "code": {
            "type": "string",
            "minLength": 1,
            "description": "策略代码"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "name",
          "code"
        ],
        "additionalProperties": false
      }
    },
    {
      "name": "delete_strategy_script",
      "label": "删除回测方案",
      "description": "删除一个已保存的回测方案（前端 /backtest 页面下拉里同步消失）。**破坏性写入**：第一次调用只返回 CONFIRM_REQUIRED 与令牌，取得用户同意后带 __confirm_token 重调。",
      "promptSnippet": "delete_strategy_script(id): 删除回测方案（需用户确认）",
      "readOnly": false,
      "parameters": {
        "type": "object",
        "properties": {
          "id": {
            "type": "integer",
            "exclusiveMinimum": 0,
            "maximum": 9007199254740991,
            "description": "要删除的方案 id（来自 list_strategy_scripts）"
          },
          "__confirm_token": {
            "description": "服务端下发的确认令牌（第一次调用后获得）",
            "type": "string"
          }
        },
        "required": [
          "id"
        ],
        "additionalProperties": false
      }
    }
  ],
  "count": 59,
  "destructive": [
    "add_to_watchlist",
    "remove_from_watchlist",
    "save_watchlist_group",
    "delete_watchlist_group",
    "assign_watchlist_group",
    "reorder_watchlist",
    "save_alert",
    "delete_alert",
    "save_anomaly_config",
    "add_portfolio_fund",
    "remove_portfolio_fund",
    "save_portfolio_group",
    "delete_portfolio_group",
    "assign_funds_to_group",
    "add_trade",
    "settle_trades",
    "delete_trade",
    "add_position",
    "update_position",
    "delete_position",
    "save_strategy",
    "delete_strategy",
    "run_strategy_code",
    "save_strategy_script",
    "delete_strategy_script"
  ]
} as const;
