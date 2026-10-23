import dotenv from "dotenv";
dotenv.config();

import { Worker, UnrecoverableError } from "bullmq";
import dbConnect from "../DB/db.js";
import { bullConnection } from "../queues/connection.js";
import { QUEUE_NAME } from "../queues/purchase.queue.js";
import { redisClient } from "../cache/redis.js";
import { product } from "../models/product.model.js";

class OutOfStockError extends UnrecoverableError {}

await dbConnect();

const processPurchase = async (job) => {
    const { prodId } = job.data;

    const prod = await product.findOneAndUpdate(
        { _id: prodId, quantity: { $gte: 1 } },
        { $inc: { quantity: -1 } },
        { returnDocument: "after" }
    );
    if (!prod) throw new OutOfStockError("No stock left in MongoDB");

    // Clearing the cache must never cause a retry, or the stock would be subtracted twice
    try {
        await redisClient.del(`product:${prodId}`);
        await redisClient.del("allproduct:1");
    } catch (err) {
        console.error("[worker] cache clear failed:", err.message);
    }
    return { remaining: prod.quantity };
};

const worker = new Worker(QUEUE_NAME, processPurchase, {
    connection: bullConnection,
    concurrency: Number(process.env.WORKER_CONCURRENCY) || 5,
});

worker.on("completed", (job) => console.log(`[worker] job ${job.id} done`));

worker.on("failed", async (job, err) => {
    if (!job) return;
    console.error(`[worker] job ${job.id} failed (attempt ${job.attemptsMade}):`, err.message);

    const isFinal = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts || 1);
    // Final failure: give the unit back. Skip this if MongoDB had no stock, since Redis and MongoDB were already out of sync.
    if (isFinal && !(err instanceof OutOfStockError)) {
        await redisClient.incrby(`stock:${job.data.prodId}`, 1);
    }
});

worker.on("error", (err) => console.error("[worker] error:", err.message));

console.log("[*] Purchase worker started -->");