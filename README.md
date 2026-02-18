# 🕷 Advanced Web Crawler

A production-grade, horizontally scalable web crawler with a real-time visualization dashboard. Watch every URL state transition live — queued, fetching, parsed, stored, or discarded — across a distributed worker fleet.

![WebCrawler Dashboard Demo](assets/demo.gif)

---

## ✨ Features

| Category | Capability |
|---|---|
| **Real-time visibility** | WebSocket-pushed events for every URL state change, streamed via Redis Streams |
| **Live graph** | ReactFlow crawl graph — nodes appear and color-shift as URLs move through the pipeline |
| **Domain-sharded queues** | 16 parallel Celery queues (`crawl.0`…`crawl.15`) via consistent hashing so slow domains never block fast ones |
| **Shard heatmap** | Per-shard activity visualization shows exactly which queue lanes are hot |
| **Discard tracking** | Every filtered URL logged with exact reason: `duplicate`, `robots_txt`, `max_depth`, `wrong_domain`, etc. |
| **Horizontal scaling** | Add workers by increasing Celery replicas; Kubernetes HPA auto-scales to 50 workers |
| **Playwright support** | Optional JS rendering per-job for SPAs |
| **Metrics sparklines** | Live pages/sec rate chart, queue depth, bytes downloaded |

---

## 🏗 Architecture

```
Browser ──── WebSocket ──── FastAPI ──── Redis Streams (event bus)
                                │
                         REST API (jobs, metrics, domains, graph)
                                │
                     SQLite / PostgreSQL (persistence)

Celery Workers (1–50) ── crawl.0 … crawl.15 queues ── Redis broker
       │
   Fetch (aiohttp / Playwright)
   Parse (BeautifulSoup)
   Filter (robots.txt, depth, domain, content-type)
   Emit events → Redis Stream → WebSocket → Dashboard
```

**Domain sharding** — `md5(domain) % 16` routes each domain to a dedicated queue. Same-domain requests stay serialized (politeness preserved). Different domains run in parallel across all 16 shards — eliminating slow-domain I/O head-of-line blocking.

---

## 🖥 Dashboard Views

| View | What you see |
|---|---|
| **Graph** | Live ReactFlow crawl graph — nodes colored by status, edges show parent→child links |
| **Table** | Filterable URL table with status, HTTP code, links found, fetch time, discard reason |
| **Feed** | Real-time event stream — every queued / fetching / stored / discarded event as it happens |
| **Domains** | 16-cell shard heatmap + per-domain table (queue assignment, pages done, avg fetch ms, active worker) |

---

## 🚀 Quick Start

### Local (dev)

```bash
# Prerequisites: Redis, Python 3.11+, Node 18+
git clone https://github.com/ss-pratapIIITB/advanced-web-crawler
cd advanced-web-crawler
chmod +x start-dev.sh && ./start-dev.sh
# Dashboard → http://localhost:5173
# API docs  → http://localhost:8000/docs
```

### Docker Compose (all-in-one)

```bash
docker compose up --build
# Scales to 4 workers by default
```

### Kubernetes (production)

```bash
kubectl apply -f infra/k8s/
# HPA auto-scales workers from 1 → 50 based on CPU
```

---

## ⚙️ Creating a Crawl Job

| Field | Description | Default |
|---|---|---|
| `seed_urls` | Starting URLs | — |
| `max_depth` | Link depth limit | 3 |
| `max_pages` | Hard stop count | 10,000 |
| `politeness_delay` | Seconds between requests per domain | 1.0 |
| `respect_robots` | Honour robots.txt | true |
| `use_playwright` | JS rendering (slower, heavier) | false |
| `allowed_domains` | Whitelist (empty = follow all) | — |

---

## 🔌 REST API

```
POST   /api/v1/jobs                  Create a crawl job
POST   /api/v1/jobs/{id}/start       Start / resume
POST   /api/v1/jobs/{id}/pause       Pause
POST   /api/v1/jobs/{id}/stop        Stop + clear frontier
GET    /api/v1/jobs/{id}/metrics     Live counters (queued, done, discarded, rate)
GET    /api/v1/jobs/{id}/graph       URL graph (nodes + edges) for visualization
GET    /api/v1/jobs/{id}/pages       Paginated crawled-page results
GET    /api/v1/jobs/{id}/discards    Discarded URLs with reasons
GET    /api/v1/jobs/{id}/domains     Per-domain stats + queue shard assignments
GET    /api/v1/queues/stats          Live depth of all 16 Celery queue shards
GET    /api/v1/workers               Connected worker states
WS     /ws                           Real-time event stream (all job events)
```

---

## 🧰 Tech Stack

**Backend** — Python 3.11, FastAPI, Celery, Redis, SQLAlchemy (async), aiohttp, BeautifulSoup, Playwright (optional)  
**Frontend** — React 18, TypeScript, Vite, Zustand, ReactFlow, Recharts, Tailwind CSS  
**Infrastructure** — Docker Compose, Kubernetes + HPA, Redis Streams, PostgreSQL

---

## 📈 Scaling

Workers consume from all 16 shards simultaneously. Adding a worker increases throughput without touching configuration:

```bash
# Docker
docker compose up --scale worker=8

# Kubernetes (or let HPA handle it)
kubectl scale deployment crawler-worker --replicas=20
```

The domain-sharding design means 16 different domains can be fetched in true parallel even on a single worker (4 concurrent coroutines × 16 queues).
