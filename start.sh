#!/bin/bash

# Exit on error
set -e

echo "🚀 Starting SentinelQAPortal System..."

# 1. Ensure we are in the project root
cd "$(dirname "$0")"

# 2. Check virtual environment
if [ ! -d "venv" ]; then
    echo "❌ Error: Virtual environment 'venv' not found. Please run setup steps first:"
    echo "   python -m venv venv && ./venv/bin/pip install -r requirements.txt"
    exit 1
fi

# 3. Check frontend node_modules
if [ ! -d "ui/node_modules" ]; then
    echo "⚠️ Warning: 'ui/node_modules' not found. Installing frontend dependencies..."
    npm --prefix ui install
fi

# 4. Start Docker Database
echo "📦 Starting PostgreSQL database via Docker..."
docker compose up -d db

# 5. Function to check and free port
free_port() {
    local port=$1
    local pid=$(lsof -t -i:$port || true)
    if [ ! -z "$pid" ]; then
        echo "⚠️ Port $port is already in use by PID $pid."
        # If running in non-interactive shell (like scripts), default to killing it.
        # Otherwise, ask the user.
        if [ -t 0 ]; then
            read -p "Do you want to stop the process running on port $port? (y/N) " yn
            case $yn in
                [Yy]* ) 
                    echo "Stopping process $pid..."
                    kill -9 $pid || true
                    sleep 1
                    ;;
                * ) 
                    echo "Leaving port $port alone. Startup might fail if there's a conflict."
                    ;;
            esac
        else
            echo "Non-interactive environment detected. Automatically stopping conflicting process on port $port (PID $pid)..."
            kill -9 $pid || true
            sleep 1
        fi
    fi
}

free_port 8000
free_port 5173

# 6. Start Backend & Frontend
echo "🔥 Starting Backend (port 8000) and Frontend (port 5173)..."

# Trap CTRL+C (SIGINT) and SIGTERM to kill background processes on exit
trap 'echo ""; echo "🛑 Stopping servers..."; kill $(jobs -p) 2>/dev/null || true; exit' INT TERM

# Start Backend
./venv/bin/uvicorn app.main:app --reload --port 8000 > backend.log 2>&1 &
BACKEND_PID=$!
echo "📡 FastAPI Backend starting (PID $BACKEND_PID)... Logs in backend.log"

# Start Frontend
npm --prefix ui run dev &
FRONTEND_PID=$!
echo "🎨 Vite Frontend starting (PID $FRONTEND_PID)..."

echo "✅ Both servers are starting up!"
echo "👉 Web Dashboard: http://localhost:5173/"
echo "👉 Backend API Docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait for background jobs
wait
