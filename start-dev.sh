#!/usr/bin/env bash
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${GREEN}🕷  Advanced Web Crawler — Dev Startup${NC}"
echo "================================================"

# Check deps
command -v redis-server &>/dev/null || { echo -e "${RED}Redis not found. Install: brew install redis${NC}"; exit 1; }
command -v python3 &>/dev/null || { echo -e "${RED}Python 3 not found${NC}"; exit 1; }
command -v node &>/dev/null || { echo -e "${RED}Node.js not found${NC}"; exit 1; }

# Start Redis
echo -e "${YELLOW}Starting Redis...${NC}"
redis-server --daemonize yes --logfile /tmp/crawler-redis.log --port 6379 2>/dev/null || true
sleep 1

# Python venv + deps
if [ ! -d "backend/.venv" ]; then
  echo -e "${YELLOW}Setting up Python environment...${NC}"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi

# Frontend deps
if [ ! -d "frontend/node_modules" ]; then
  echo -e "${YELLOW}Installing frontend dependencies...${NC}"
  (cd frontend && npm install --silent)
fi

echo -e "${GREEN}Starting services...${NC}"

# API server
backend/.venv/bin/python -m uvicorn backend.api.main:app \
  --host 0.0.0.0 --port 8000 --reload &
API_PID=$!
echo "  API server → http://localhost:8000  (PID $API_PID)"

# Celery worker (2 concurrent goroutines for dev)
PYTHONPATH=. backend/.venv/bin/celery -A backend.crawler.worker worker \
  --loglevel=warning -Q crawl --concurrency=4 &
WORKER_PID=$!
echo "  Worker     → PID $WORKER_PID"

# Celery beat
PYTHONPATH=. backend/.venv/bin/celery -A backend.crawler.worker beat \
  --loglevel=warning &
BEAT_PID=$!
echo "  Beat       → PID $BEAT_PID"

# Frontend dev server
(cd frontend && npm run dev) &
FRONT_PID=$!
echo "  Dashboard  → http://localhost:5173  (PID $FRONT_PID)"

echo ""
echo -e "${GREEN}✓ All services started!${NC}"
echo -e "  Dashboard:  ${GREEN}http://localhost:5173${NC}"
echo -e "  API docs:   ${GREEN}http://localhost:8000/docs${NC}"
echo -e "  Flower:     Run: celery -A backend.crawler.worker flower"
echo ""
echo "Press Ctrl+C to stop all services"

trap "echo 'Stopping...'; kill $API_PID $WORKER_PID $BEAT_PID $FRONT_PID 2>/dev/null; redis-cli shutdown 2>/dev/null; exit 0" INT

wait
