import Redis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

const redisClient = new Redis(process.env.REDIS_URL);

redisClient.on("connect", () => {
    console.log("[*] Redis connected -->");
});

redisClient.on("error", (err) => {
    console.error("[!] Redis connection error:", err.message);
    process.exit(1);
});

export { redisClient };
