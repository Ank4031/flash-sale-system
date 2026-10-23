# Flash Sale System

A Node.js backend for managing products and handling flash-sale purchases under concurrent load. It provides progressively stronger purchase paths: a basic atomic MongoDB decrement, a Redis stock gate, and an asynchronous Redis + BullMQ queue backed by a worker.

## Technology stack

- **Node.js 20** and **Express 5** — HTTP API
- **MongoDB** with **Mongoose 9** — persistent product and stock data
- **Redis** with **ioredis** — product caching and atomic flash-sale stock reservation
- **BullMQ** — purchase-job queue, retries, and backoff
- **Docker Compose** — local API, worker, MongoDB, and Redis Stack services
- **k6** — optional concurrent-load test (`buy-testing.js`)

## Architecture

```text
                         +------------------------------+
Client / k6 ----------> | Express API :3000             |
                         | src/index.js                  |
                         +---------------+--------------+
                                         |
                    +--------------------+---------------------+
                    |                                          |
                    v                                          v
             +-------------+                           +--------------+
             | MongoDB     |                           | Redis        |
             | products    |                           | cache +      |
             +-------------+                           | stock gate   |
                    ^                                   +------+-------+
                    |                                          |
                    |                              +-----------+-----------+
                    |                              |                       |
                    |                              v                       v
                    |                       Express API             BullMQ queue
                    |                                                      |
                    +-----------------------------+                        v
                                                  |                +----------------+
                                                  +----------------| Purchase worker|
                                                                   +----------------+
```

The API and purchase worker are separate processes. Both connect to MongoDB and Redis. Redis serves cached product reads and, for the Redis-backed purchase routes, keeps an expiring `stock:<productId>` counter. BullMQ stores queued purchase jobs in Redis; the worker applies accepted purchases to MongoDB and invalidates product caches.

### Request flow

1. **Create a product:** `POST /api/v1/products/add` stores the product and its starting quantity in MongoDB.
2. **Initialize flash-sale stock:** call `GET /api/v1/products/initstock/:prodId` before using a Redis-backed purchase route. It copies the MongoDB quantity into Redis if the counter has not already been initialized.
3. **Reserve stock in Redis:** `/buy_redis/:prodId` and `/buy_queue/:prodId` run a Lua script that checks and decrements the Redis counter atomically. Requests with no initialized counter or no remaining stock receive `409`.
4. **Complete the purchase:**
   - `/buy/:prodId` performs a conditional, atomic MongoDB decrement synchronously and returns the result.
   - `/buy_redis/:prodId` reserves in Redis, then decrements MongoDB synchronously.
   - `/buy_queue/:prodId` reserves in Redis, enqueues a BullMQ job, and returns `202 Accepted`. The worker later decrements MongoDB and clears the product caches.
5. **Read products:** product and product-list reads use Redis caches with an expiry. Product updates and purchases invalidate the relevant cached data.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with Docker Compose v2, for the recommended containerized setup.
- Alternatively, Node.js 20+ and npm, with MongoDB and Redis available locally.
- Optional: [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) to run the load test.

## Run with Docker Compose

From the repository root:

```sh
docker compose up --build -d
docker compose ps
docker compose logs -f app worker
```

Compose starts the API, purchase worker, MongoDB, and Redis Stack. The API is at `http://localhost:3000`; the Redis Stack web interface is at `http://localhost:8001`.

Check the API:

```sh
curl http://localhost:3000/health
```

Useful Docker commands:

```sh
docker compose build                 # Build the application image
docker compose up -d                 # Start services in the background
docker compose logs -f               # Follow logs from all services
docker compose logs -f app worker    # Follow API and worker logs
docker compose ps                    # Show service status
docker compose exec redis redis-cli PING
docker compose down                  # Stop and remove containers; keep MongoDB data
docker compose down -v               # Also delete the MongoDB data volume
```

> `docker compose down -v` permanently removes the local MongoDB volume and its data.

### Try the queued purchase flow (PowerShell)

Create a product, initialize its Redis stock counter, then submit a queued purchase:

```powershell
$product = Invoke-RestMethod -Method Post `
  -Uri http://localhost:3000/api/v1/products/add `
  -ContentType 'application/json' `
  -Body '{"name":"Flash item","description":"Demo","price":25,"quantity":5}'

$id = $product._id
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/products/initstock/$id"
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/v1/products/buy_queue/$id"
```

The queued endpoint responds with `202` and a `jobId`. Follow `docker compose logs -f worker` to see job completion, and fetch the product afterward to check its MongoDB quantity:

```powershell
Invoke-RestMethod -Method Get -Uri "http://localhost:3000/api/v1/products/get/$id"
```

The initial stock counter is not automatically populated when a product is created. Initialize it again after Redis data is lost or expires.

## Run locally without a containerized API

Use Compose for only the databases, then run the API and worker with Node.js:

```sh
docker compose up -d mongo redis
npm ci
```

Create a `.env` file in the project root with local connection URLs:

```dotenv
PORT=3000
MONGO_URL=mongodb://localhost:27017/mydb
REDIS_URL=redis://localhost:6379
CACHE_TTL=300
WORKER_CONCURRENCY=5
```

Run these in two terminals:

```sh
npm run dev
```

```sh
npm run worker
```

The API and worker need to be running for the queued-purchase route to complete jobs. The `.env` file is ignored by Git; do not commit credentials or secrets.

## API routes

All product routes are under `/api/v1/products`.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/add` | Create a product |
| `GET` | `/all` | List products |
| `GET` | `/get/:prodId` | Get one product |
| `PUT` | `/updateprice/:prodId` | Update a product price |
| `PUT` | `/updatequantity/:prodId` | Update quantity |
| `DELETE` | `/delete/:prodId` | Delete a product |
| `POST` | `/buy/:prodId` | Buy with an atomic MongoDB decrement |
| `GET` | `/initstock/:prodId` | Initialize the Redis sale-stock counter |
| `POST` | `/buy_redis/:prodId` | Reserve in Redis, then update MongoDB synchronously |
| `POST` | `/buy_queue/:prodId` | Reserve in Redis and enqueue an asynchronous purchase |

The health check is `GET /health`. Product creation expects JSON such as `{"name":"Flash item","price":25,"quantity":5}`. Price updates expect `{"price":20}`; quantity updates expect `{"quantity":4}`.

## Load test

With the Docker Compose stack running and k6 installed:

```sh
k6 run buy-testing.js
```

The script creates a fresh product with five units, initializes Redis stock, then defaults to 30 virtual users making 30 attempts each against the queued route. It checks that successful purchases do not exceed the available stock. For example, to target the synchronous Redis route:

```sh
k6 run -e BUY_PATH=/api/v1/products/buy_redis/ buy-testing.js
```

## Performance report

The accompanying [performance report](./flashsalessys_performance_report.pdf) compares the naive purchase endpoint, atomic MongoDB updates, the Redis stock gate, and Redis + BullMQ using k6. Its key reported results include:

- Under 30 simultaneous users competing for five units, the naive read/check/save route sold 10 units; each later tested stage sold five.
- In the 90-request runs, the Redis-gated stage reported a 24.8 ms median response time, versus 53.5–128.3 ms across three atomic-MongoDB runs. The report treats the median difference as promising but p95 and throughput differences as inconclusive.
- The Redis + BullMQ run processed 900 requests with zero reported request errors and a 106.7 ms p95. It used ten times as many requests as the earlier runs, so its latency is **not a like-for-like comparison**.
- The report notes that the queue run did not include worker logs or a final MongoDB stock check. The API's `202` response confirms that a job was accepted, not that its database update completed.

These are short local-machine measurements, not production guarantees. See the PDF for raw results, methodology, caveats, and recommended follow-up tests.
