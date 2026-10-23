import dotenv from "dotenv";
dotenv.config();

const url = new URL(process.env.REDIS_URL || "redis://localhost:6379");

export const bullConnection = {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
};