import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

// ---- settings (override with -e NAME=value) ----
const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const BUY_PATH = __ENV.BUY_PATH || "/api/v1/products/buy_redis/";            // e.g. /api/v1/products/buy-redis/
const INIT_PATH = __ENV.INIT_PATH || "/api/v1/products/initStock/";    // must match your init-stock route
const STOCK = Number(__ENV.STOCK || 5);                                // units available in the test product
const USERS = Number(__ENV.USERS || 30);                               // simultaneous users
const ITERATIONS = Number(__ENV.ITERATIONS || 3);                      // buy attempts per user

// ---- custom counters ----
const purchased = new Counter("purchases_success"); // 200 or 202
const soldOut = new Counter("sold_out");            // 400 or 409
const unexpected = new Counter("unexpected_errors");

// 201 (created) and 400/409 (sold out) are expected answers, so don't count them as failed requests
http.setResponseCallback(http.expectedStatuses(200, 201, 202, 400, 409));

export const options = {
    scenarios: {
        flash_sale: {
            executor: "per-vu-iterations",
            vus: USERS,
            iterations: ITERATIONS,
            maxDuration: "60s",
        },
    },
    thresholds: {
        // The key check: successful purchases must never exceed the stock
        purchases_success: [`count<=${STOCK}`],
        unexpected_errors: ["count==0"],
        http_req_duration: ["p(95)<1000"],
    },
};

const headers = { "Content-Type": "application/json" };

// Runs once before the test: create a fresh product, then load its stock into Redis
export function setup() {
    // 1) create the product -> MongoDB generates the id for us
    const created = http.post(
        `${BASE_URL}/api/v1/products/add`,
        JSON.stringify({
            name: "k6 flash item",
            description: "load test product",
            price: 100,
            quantity: STOCK,
        }),
        { headers }
    );
    const createdOk = check(created, { "test product created": (r) => r.status === 201 });
    if (!createdOk) throw new Error(`Could not create product: ${created.status} ${created.body}`);

    const prodId = created.json("_id");

    // 2) copy that product's stock into Redis (needed by the buy-redis route)
    const init = http.get(`${BASE_URL}${INIT_PATH}${prodId}`, null, { headers });
    const initOk = check(init, { "stock initialized": (r) => r.status === 200 });
    if (!initOk) throw new Error(`init-stock failed: ${init.status} ${init.body}`);

    return { prodId };
}

// Runs for every virtual user, every iteration
export default function (data) {
    const res = http.post(
        `${BASE_URL}${BUY_PATH}${data.prodId}`,
        JSON.stringify({ userId: `user-${__VU}` }),
        { headers }
    );

    if (res.status === 200 || res.status === 202) {
        purchased.add(1);
    } else if (res.status === 400 || res.status === 409) {
        soldOut.add(1);
    } else {
        unexpected.add(1);
        console.error(`Unexpected status ${res.status}: ${res.body}`);
    }
}

// Runs once after the test: show what the database says now
export function teardown(data) {
    const res = http.get(`${BASE_URL}/api/v1/products/get/${data.prodId}`);
    if (res.status === 200) {
        console.log(`Final stock for ${data.prodId}: ${res.json("quantity")} (expected 0)`);
    }
    console.log(`Redis check: docker exec -it redis-stack redis-cli GET stock:${data.prodId}  (expected 0)`);
}