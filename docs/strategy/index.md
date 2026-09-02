# 策略研究 (Strategy Research)

## 一、概述

策略研究板块让用户与 AI 讨论、制定、完善个人投资策略，并通过「AI 辅助 + 手动确认」的方式沉淀为**策略记忆**。策略记忆启用后，AI 会在**基金分析、持仓诊断、AI 对话**三个场景中自动参考，使分析与建议贴合用户的策略取向。

页面路径：`/strategy`（顶部导航 / 移动端抽屉 / 底部导航均显示为「策略研究」），与投研看板同级，桌面端左右分栏（左：策略记忆列表 + 编辑表单；右：策略讨论聊天区），移动端（≤900px）上下堆叠。

## 二、功能清单

| 功能 | 说明 |
|------|------|
| 策略记忆 CRUD | 新增 / 编辑 / 删除 / 启用·停用，支持标题、内容、标签（逗号分隔）、来源标记（手动 / AI起草） |
| AI 策略讨论 | 右侧聊天区复用主聊天窗口 `ChatPanel`（`channel='strategy'` + 强制 `strategy` 技能），可调用数据工具核对基金/行情 |
| 保存为策略 | 策略频道中任意 AI 回复可一键「保存为策略」，预填编辑表单，确认后入库 |
| AI 帮我起草 | 编辑表单中输入主题，调用前端 `strategyDraft.draftStrategy()` 生成结构化草案（标题 / 内容 / 标签）后预填 |
| 全局生效 | 所有启用中的策略自动注入基金分析、持仓诊断、AI 对话的提示词 |

## 统一聊天窗口

策略讨论复用主 AI 聊天的同一组件（`ChatPanel.vue`）与同一 store（`chatStore`）：

- `channel` prop 隔离会话：主聊天 `channel='chat'`（默认），策略研究板块 `channel='strategy'`，会话按 channel 各自存储（Dexie `chatSessions.channel`）与列表展示
- `force-skill='strategy'` 锁定策略技能（隐藏技能下拉，显示固定"策略"标签）；主聊天技能列表也新增「策略」选项，可在任意页面选择讨论策略
- `embedded` prop 让浮层样式平铺到页面列内；策略路由下隐藏悬浮气泡（`ChatBubble`），避免双实例争用同一 store
- 策略频道内每条 AI 回复提供「保存为策略」按钮，经 `emit('save-draft')` 预填策略记忆编辑表单

### 保存为策略（端到端流程）

```
策略频道 AI 回复
  → 点击「保存为策略」（emit('save-draft', { title, content }) 上抛到 StrategyView）
  → 预填策略记忆编辑表单（startCreate + 填充 title/content）
  → 用户确认（可改标题/标签/内容/启用开关）
  → addStrategy() 写入 Dexie strategies 表（source='manual'，已建记录手动改）
  → 列表刷新，策略记忆即刻生效（active=1 时进入 AI 注入链路）
```

## 三、数据流概览

### 页面布局

- 桌面端：`grid-template-columns: 380px 1fr` —— 左栏 380px 策略记忆列表 + 编辑表单，右栏策略讨论聊天区
- 移动端：`max-width: 900px` 断点降为单列，上下堆叠（先记忆列表，后聊天区）

```
策略讨论
  用户在 /strategy 页面右侧（嵌入的 ChatPanel，channel='strategy'，skill 固定为 strategy）
    → chatEngine.chat(skill='strategy', strategyContext=启用策略)（本地事件流）
    → 消息持久化到 Dexie chatSessions(chatMessages) channel='strategy'

AI 帮我起草
  表单输入主题
    → strategyDraft.draftStrategy({topic, strategyContext}, llmConfig)（前端直调 LLM）
    → LLM 输出 JSON {title, content, tags}（无 Key 时返回模板降级）

保存为策略
  AI 回复 → 「保存为策略」→ 预填表单 → 用户确认
    → addStrategy() 写入 Dexie strategies 表
```

## 四、关键文件

| 层 | 文件 | 职责 |
|----|------|------|
| 前端页面 | `frontend/src/views/StrategyView.vue` + `StrategyView.css` | 页面布局、策略记忆列表、编辑表单、AI 起草接入 |
| 前端聊天 | `frontend/src/components/ChatPanel.vue` + `ChatPanel.css` | 复用主聊天窗口：`channel` / `force-skill` / `embedded` props + 保存为策略 |
| 前端数据 | `frontend/src/db/strategyMemory.ts` | 策略记忆 CRUD + `buildStrategyContext()` 上下文格式化 |
| 前端存储 | `frontend/src/db/index.ts` | Dexie v4：`strategies` 表、`chatSessions` 增加 `channel` 索引 |
| 前端服务 | `frontend/src/services/chatApi.ts` | `sendMessage` 支持 `strategyContext`、按 channel 查询会话；引擎在前端 `chatEngine/` |
| 前端状态 | `frontend/src/stores/chatStore.ts` | 频道化状态：`channel`、按频道加载会话/发送、技能锁定 |
| 前端起草 | `frontend/src/services/strategyDraft.ts` | 策略起草 LLM 调用（前端直调）+ 模板降级 |
| 前端引擎 | `frontend/src/services/chatEngine/skills.ts` | `strategy` 技能（系统提示词 + 工具集） |

## 五、配置要求

- AI 起草与策略讨论依赖 LLM 配置，未配置时：
  - 讨论聊天返回「AI 服务未配置」错误（与主聊天一致）
  - 「AI 帮我起草」返回内容占位模板，仍可手动编辑保存
