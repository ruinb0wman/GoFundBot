#!/usr/bin/env bash
#
# GoFundBot 一键安装脚本
#
#   ./setup.sh                安装全部：Node 子项目 + Python venv + git hooks
#   ./setup.sh --skip-python  只装 Node 子项目（packages/ui / service / frontend / docs）
#   ./setup.sh --skip-node    只装 Python venv + git hooks
#
# Node 侧统一使用 bun（与根目录 `bun dev` 一致）。脚本可重复执行：已装好的依赖会走增量，
# 已存在的 venv 会复用，不会覆盖 python/.venv。
#
# 注意：此时序是刻意的 —— packages/ui 必须先于 frontend 安装，
# 因为 frontend 依赖 `@gofund/ui: file:../packages/ui`。
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# ---------------------------------------------------------------- 输出helpers
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'; C_DIM=$'\033[2m'
else
  C_RESET=''; C_BLUE=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_DIM=''
fi

step() { printf '\n%s==>%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
info() { printf '%s    %s%s\n' "$C_DIM" "$*" "$C_RESET"; }
ok()   { printf '%s  ✓ %s%s\n' "$C_GREEN" "$*" "$C_RESET"; }
warn() { printf '%s  ! %s%s\n' "$C_YELLOW" "$*" "$C_RESET"; }
fail() { printf '%s  ✗ %s%s\n' "$C_RED" "$*" "$C_RESET" >&2; }

CURRENT_STEP=''
START_TS=$SECONDS

on_error() {
  local code=$?
  fail "步骤失败：${CURRENT_STEP:-未知}（退出码 $code）"
  printf '\n%s安装中断。修好上面的报错后重新执行 ./setup.sh 即可（可重复执行）。%s\n' \
    "$C_RED" "$C_RESET" >&2
  exit "$code"
}
trap on_error ERR

usage() {
  cat <<'EOF'
GoFundBot 一键安装脚本

  ./setup.sh                安装全部：Node 子项目 + Python venv + git hooks
  ./setup.sh --skip-python  只装 Node 子项目（packages/ui / service / frontend / docs）
  ./setup.sh --skip-node    只装 Python venv + git hooks
  ./setup.sh -h | --help    显示本帮助

Node 侧统一使用 bun（与根目录 `bun dev` 一致）。脚本可重复执行：已装好的依赖走增量，
已存在的 venv 会复用，不会覆盖 python/.venv。

安装顺序是刻意的 —— packages/ui 必须先于 frontend，
因为 frontend 依赖 `@gofund/ui: file:../packages/ui`。

环境变量：
  PYTHON   指定 Python 解释器（默认 python3）
EOF
}

# ------------------------------------------------------------------- 参数解析
SKIP_NODE=0
SKIP_PYTHON=0

for arg in "$@"; do
  case "$arg" in
    --skip-node)   SKIP_NODE=1 ;;
    --skip-python) SKIP_PYTHON=1 ;;
    -h|--help)     usage; exit 0 ;;
    *)             fail "未知参数：$arg"; echo; usage >&2; exit 2 ;;
  esac
done

if [ "$SKIP_NODE" = 1 ] && [ "$SKIP_PYTHON" = 1 ]; then
  fail "不能同时 --skip-node 和 --skip-python（那就什么都不做了）"
  exit 2
fi

PYTHON_BIN="${PYTHON:-python3}"
VENV="python/.venv"
PRE_COMMIT="$VENV/bin/pre-commit"

# --------------------------------------------------------------- Node 子项目
# 格式：目录|说明   —— 顺序即安装顺序，ui 必须在 frontend 之前
NODE_PROJECTS=(
  ".|根目录（concurrently 一键启动器）"
  "packages/ui|@gofund/ui 组件库"
  "service|Express 数据服务"
  "frontend|Vue 3 前端"
  "docs|VitePress 文档站"
)

install_node_deps() {
  if ! command -v bun >/dev/null 2>&1; then
    fail "未找到 bun。请先安装 bun（curl -fsSL https://bun.sh/install | bash）"
    info "或按 README「安装依赖」用 npm 逐目录安装"
    return 1
  fi
  info "包管理器：bun $(bun --version)   registry：$(bun pm config get registry 2>/dev/null || echo 默认)"

  local entry dir label
  for entry in "${NODE_PROJECTS[@]}"; do
    dir="${entry%%|*}"; label="${entry#*|}"
    if [ ! -f "$dir/package.json" ]; then
      warn "跳过 $dir（没有 package.json）"
      continue
    fi
    CURRENT_STEP="安装 Node 依赖：$dir（$label）"
    step "$CURRENT_STEP"
    ( cd "$dir" && bun install --no-summary )
  done
}

# --------------------------------------------------------------- Python venv
install_python_deps() {
  if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    fail "未找到 $PYTHON_BIN（可用环境变量 PYTHON 指定解释器）"
    return 1
  fi
  info "Python：$("$PYTHON_BIN" --version 2>&1)"

  if [ ! -d "$VENV" ]; then
    CURRENT_STEP="创建 Python 虚拟环境（$VENV）"
    step "$CURRENT_STEP"
    "$PYTHON_BIN" -m venv "$VENV"
  else
    info "复用已有虚拟环境 $VENV"
  fi

  CURRENT_STEP="安装 Python 依赖（requirements.txt + requirements-dev.txt）"
  step "$CURRENT_STEP"
  if ! "$VENV/bin/pip" install -q \
      -r python/requirements.txt -r python/requirements-dev.txt; then
    warn "默认 PyPI 源失败，改用清华镜像重试"
    "$VENV/bin/pip" install -q \
      -r python/requirements.txt -r python/requirements-dev.txt \
      -i https://pypi.tuna.tsinghua.edu.cn/simple \
      --trusted-host pypi.tuna.tsinghua.edu.cn
  fi
  ok "Python 依赖就绪"
}

# ------------------------------------------------------------------ git hooks
install_git_hooks() {
  if [ ! -d .git ]; then
    warn "当前不是 git 仓库，跳过 pre-commit 钩子"
    return 0
  fi
  if [ ! -x "$PRE_COMMIT" ]; then
    warn "未找到 $PRE_COMMIT，跳过 pre-commit 钩子"
    return 0
  fi

  CURRENT_STEP="安装 git 钩子（pre-commit install --install-hooks）"
  step "$CURRENT_STEP"
  # 钩子需要联网拉取 hook 仓库，失败不影响 dev 启动 → 只告警不中断
  if "$PRE_COMMIT" install --install-hooks; then
    ok "pre-commit 钩子已安装"
  else
    warn "pre-commit 钩子安装失败（多半是网络问题），可稍后手动重跑："
    info "python/.venv/bin/pre-commit install --install-hooks"
  fi
}

# ------------------------------------------------------------------ 结果自检
verify() {
  CURRENT_STEP="校验关键可执行文件"
  step "$CURRENT_STEP"

  local -a missing=()
  local -a targets=(
    "node_modules/.bin/concurrently|根目录 concurrently"
    "packages/ui/node_modules/.bin/vite|packages/ui vite"
    "service/node_modules/.bin/tsx|service tsx"
    "frontend/node_modules/.bin/vite|frontend vite"
    "docs/node_modules/.bin/vitepress|docs vitepress"
  )

  local entry bin label
  for entry in "${targets[@]}"; do
    bin="${entry%%|*}"; label="${entry#*|}"
    if [ -x "$bin" ]; then
      ok "$label"
    else
      fail "$label 缺失（$bin）"
      missing+=("$label")
    fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    fail "缺失 ${#missing[@]} 项，上游安装步骤可能被跳过了（--skip-node？）"
    return 1
  fi
}

# --------------------------------------------------------------------- 主流程
printf '%sGoFundBot 环境安装%s  %s(%s)%s\n' \
  "$C_BLUE" "$C_RESET" "$C_DIM" "$ROOT" "$C_RESET"

if [ "$SKIP_NODE" = 0 ]; then
  install_node_deps
else
  warn "已跳过 Node 依赖（--skip-node）"
fi

if [ "$SKIP_PYTHON" = 0 ]; then
  install_python_deps
  install_git_hooks
else
  warn "已跳过 Python 环境与 git 钩子（--skip-python）"
fi

if [ "$SKIP_NODE" = 0 ]; then
  verify
fi

printf '\n%s安装完成%s  用时 %ss\n' "$C_GREEN" "$C_RESET" "$((SECONDS - START_TS))"
printf '下一步：%sbun dev%s  （= 后端 :8310 + 前端 :8517 + 文档站 :8574）\n' "$C_BLUE" "$C_RESET"
