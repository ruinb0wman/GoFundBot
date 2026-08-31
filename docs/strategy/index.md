# 策略板块 (Strategy Board)

## 一、概述

策略板块让用户与 AI 讨论、制定、完善个人投资策略，并通过「AI 辅助 + 手动确认」的方式沉淀为**策略记忆**。策略记忆启用后，AI 会在**基金分析、持仓诊断、AI 对话**三个场景中自动参考，使分析与建议贴合用户的策略取向。

页面路径：`/strategy`，与投研看板同级，桌面端左右分栏（左：策略记忆列表 + 编辑表单；右：策略讨论聊天区），移动端上下堆叠。

## 二、功能清单

| 功能 | 说明 |
|------|------|
| 策略记忆 CRUD | 新增 / 编辑 / 删除 / 启用·停用，支持标题、内容、标签（逗号分隔）、来源标记（手动 / AI起草） |
| AI 策略讨论 | 右侧聊天区复用主聊天窗口 `ChatPanel`（`channel='strategy'` + 强制 `strategy` 技能），可调用数据工具核对基金/行情 |
| 保存为策略 | 策略频道中任意 AI 回复可一键「保存为策略」，预填编辑表单，确认后入库 |
| AI 帮我起草 | 编辑表单中输入主题，调用 `POST /api/strategy/draft` 生成结构化草案（标题 / 内容 / 标签）后预填 |
| 全局生效 | 所有启用中的策略自动注入基金分析、持仓诊断、AI 对话的提示词 |

## 统一聊天窗口

策略讨论复用主 AI 聊天的同一组件（`ChatPanel.vue`）与同一 store（`chatStore`）：

- `channel` prop 隔离会话：主聊天 `channel='chat'`（默认），策略板块 `channel='strategy'`，会话按 channel 各自存储（Dexie `chatSessions.channel`）与列表展示
- `force-skill='strategy'` 锁定策略技能（隐藏技能下拉，显示固定"策略"标签）；主聊天技能列表也新增「策略」选项，可在任意页面选择讨论策略
- `embedded` prop 让浮层样式平铺到页面列内；策略路由下隐藏悬浮气泡（`ChatBubble`），避免双实例争用同一 store
- 策略频道内每条 AI 回复提供「保存为策略」按钮，经 `emit('save-draft')` 预填策略记忆编辑表单

## 三、数据流概览

```
策略讨论
  用户在 /strategy 页面右侧（嵌入的 ChatPanel，channel='strategy'，skill 固定为 strategy）
    → chatAPI.sendMessage(skill='strategy', strategyContext=启用策略)
    → POST /api/chat SSE 流式返回
    → 消息持久化到 Dexie chatSessions(chatMessages) channel='strategy'

AI 帮我起草
  表单输入主题
    → strategyAPI.draft({topic, strategyContext})
    → POST /api/strategy/draft → strategyService.draftStrategy()
    → LLM 输出 JSON {title, content, tags}（无 Key 时返回模板降级）

保存为策略
  AI 回复 → 「保存为策略」→ 预填表单 → 用户确认
    → addStrategy() 写入 Dexie strategies 表
```

## 四、关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| 前端页面 | `Frontend/src/views/StrategyView.vue` + `StrategyView.css` | 页面布局、策略记忆列表、编辑表单、AI 起草接入 |
| 前端聊天 | `Frontend/src/components/ChatPanel.vue` + `ChatPanel.css` | 复用主聊天窗口：`channel` / `force-skill` / `embedded` props + 保存为策略 |
| 前端数据 | `Frontend/src/db/strategyMemory.ts` | 策略记忆 CRUD + `buildStrategyContext()` 上下文格式化 |
| 前端存储 | `Frontend/src/db/index.ts` | Dexie v4：`strategies` 表、`chatSessions` 增加 `channel` 索引 |
| 前端服务 | `Frontend/src/services/chatApi.ts` | `sendMessage` 支持 `strategyContext`、按 channel 查询会话 |
| 前端状态 | `Frontend/src/stores/chatStore.ts` | 频道化状态：`channel`、按频道加载会话/发送、技能锁定 |
| 后端路由 | `Service/src/routes/strategy.routes.ts` | `POST /api/strategy/draft` |
| 后端服务 | `Service/src/services/strategyService.ts` | 策略起草 LLM 调用 + 模板降级 |
| 后端技能 | `Service/src/services/chatSkills.ts` | `strategy` 技能（系统提示词 + 工具集） |

## 五、配置要求

- AI 起草与策略讨论依赖 LLM 配置，未配置时：
  - 讨论聊天返回「AI 服务未配置」错误（与主聊天一致）
  - 「AI 帮我起草」返回内容占位模板，仍可手动编辑保存
