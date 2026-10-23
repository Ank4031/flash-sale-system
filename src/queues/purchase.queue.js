import { Queue } from "bullmq";
import { bullConnection } from "./connection.js";

export const QUEUE_NAME = "purchases";

export const purchaseQueue = new Queue(QUEUE_NAME, {
    connection: bullConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
    },
});