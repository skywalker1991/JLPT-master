#!/bin/bash

# 启动前后端开发服务器

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 启动 JLPT 项目..."

# 启动后端
echo "📦 启动后端服务 (FastAPI)..."
cd "$SCRIPT_DIR/apps/backend"

# 激活虚拟环境
if [ -d "venv" ]; then
    echo "   激活虚拟环境..."
    source venv/bin/activate
else
    echo "   ⚠️  未找到虚拟环境，请先创建: python -m venv venv"
    exit 1
fi

# 加载环境变量
if [ -f ".env" ]; then
    echo "   加载环境变量..."
    export $(cat .env | grep -v '^#' | xargs)
else
    echo "   ⚠️  未找到 .env 文件"
fi

# 继承当前 shell 的代理设置
if [ ! -z "$HTTP_PROXY" ]; then
    echo "   使用代理: $HTTP_PROXY"
fi

uvicorn api:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# 等待后端启动
sleep 2

# 启动前端
echo "🎨 启动前端服务 (Next.js)..."
cd "$SCRIPT_DIR/apps/web"
pnpm dev &
FRONTEND_PID=$!

echo ""
echo "✅ 服务已启动："
echo "   后端: http://localhost:8000 (PID: $BACKEND_PID)"
echo "   前端: http://localhost:3000 (PID: $FRONTEND_PID)"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 捕获 Ctrl+C 信号并清理进程
trap "echo '\n⏹️  停止服务...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM

# 保持脚本运行
wait
