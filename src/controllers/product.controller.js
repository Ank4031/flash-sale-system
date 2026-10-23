import { product } from "../models/product.model.js";
import AsyncHandler from "../utilities/AsyncHandler.js";
import {redisClient} from "../cache/redis.js";
import mongoose from "mongoose";

const RESERVE_STOCK_LUA = `
local stock = tonumber(redis.call('GET', KEYS[1]))
if not stock then return -1 end
if stock < tonumber(ARGV[1]) then return -2 end
return redis.call('DECRBY', KEYS[1], ARGV[1])
`;

const createProduct = AsyncHandler(async (req, res) => {
    const {name, description, price, quantity} = req.body;
    const newProduct = await product.create({name, description, price, quantity});
    console.log("New product created");
    res.status(201).json(newProduct);
});

const buyProductRedis = AsyncHandler(async (req, res) => {
    const { prodId } = req.params;
    if (!mongoose.isValidObjectId(prodId)) {
        return res.status(400).json({ message: "Invalid product id" });
    }
    const stockKey = `stock:${prodId}`;

    // Step 1: ask Redis for permission
    const result = await redisClient.eval(RESERVE_STOCK_LUA, 1, stockKey, 1);
    if (result === -1) {
        return res.status(409).json({ message: "Sale has not started" });
    }
    if (result === -2) {
        return res.status(409).json({ message: "Sold out" });
    }

    // Step 2: Redis approved, so update MongoDB
    let prod;
    try {
        prod = await product.findOneAndUpdate(
            { _id: prodId, quantity: { $gte: 1 } },
            { $inc: { quantity: -1 } },
            { returnDocument: "after" }
        );
    } catch (err) {
        await redisClient.incrby(stockKey, 1); // MongoDB failed, give the unit back
        throw err;
    }
    if (!prod) {
        return res.status(409).json({ message: "Product is out of stock" });
    }

    // Step 3: clear stale caches
    await redisClient.del(`product:${prodId}`);
    await redisClient.del("allproduct:1");
    return res.status(200).json({ message: "Product purchased successfully", product: prod });
});

const getProductById = AsyncHandler(async (req, res) => {
    const {prodId} = req.params;
    const cacheKey = `product:${prodId}`;
    const cachedProduct = await redisClient.get(cacheKey);
    if (cachedProduct) {
        console.log("Product fetched from cache");
        return res.status(200).json(JSON.parse(cachedProduct));
    }
    const prod = await product.findById(prodId);
    if (!prod) {
        return res.status(404).json({ message: "Product not found" });
    }
    await redisClient.set(cacheKey, JSON.stringify(prod), "EX", process.env.CACHE_TTL || 300);
    console.log("Product fetched from database and cached");
    return res.status(200).json(prod);
});

const getAllProducts = AsyncHandler(async (req, res) => {
    const cacheKey = "allproduct:1";
    const cachedProducts = await redisClient.get(cacheKey);
    if (cachedProducts) {
        console.log("All products fetched from cache");
        return res.status(200).json(JSON.parse(cachedProducts));
    }

    const products = await product.find();
    await redisClient.set(cacheKey, JSON.stringify(products),"EX", process.env.CACHE_TTL || 300);
    console.log("All products fetched from database and cached");
    return res.status(200).json(products);
})

const updateprice = AsyncHandler(async (req, res) => {
    const {prodId} = req.params;
    const {price} = req.body;
    const cacheKey = `product:${prodId}`;
    const prod = await product.findOneAndUpdate({ _id: prodId }, { price }, { new: true });
    if (!prod) {
        return res.status(404).json({ message: "Product not found" });
    }
    await redisClient.set(cacheKey, JSON.stringify(prod), "EX", process.env.CACHE_TTL || 300);
    console.log("Product price updated and cached");
    return res.status(200).json(prod);
})

const updatequantity = AsyncHandler(async (req, res) => {
    const {prodId} = req.params;
    const {quantity} = req.body;
    const cacheKey = `product:${prodId}`;
    const prod = await product.findOneAndUpdate({ _id: prodId }, { quantity }, { new: true });
    if (!prod) {
        return res.status(404).json({ message: "Product not found" });
    }
    await redisClient.set(cacheKey, JSON.stringify(prod), "EX", process.env.CACHE_TTL || 300);
    await redisClient.del("allproduct:1");
    console.log("Product quantity updated and cached");
    return res.status(200).json(prod);
})

const buy_naive = AsyncHandler(async (req, res) => {
    const {prodId} = req.params;
    const cacheKey = `product:${prodId}`;
    const prod = await product.findById(prodId);
    if (!prod) {
        return res.status(404).json({ message: "Product not found" });
    }
    if (prod.quantity <= 0) {
        return res.status(400).json({ message: "Product is out of stock" });
    }
    prod.quantity -= 1;
    await prod.save();
    await redisClient.set(cacheKey, JSON.stringify(prod), "EX", process.env.CACHE_TTL || 300);
    await redisClient.del("allproduct:1");
    console.log("Product purchased and cache updated");
    return res.status(200).json({ message: "Product purchased successfully", product: prod });
});

const buyProduct = AsyncHandler(async (req, res) => {
    const {prodId} = req.params;
    const cacheKey = `product:${prodId}`;
    const prod = await product.findOneAndUpdate(
        { _id: prodId, quantity: { $gte: 1 } },  // condition
        { $inc: { quantity: -1 } },               // action
        { returnDocument: "after" }
    );
    if (!prod) {
        const exists = await product.exists({ _id: prodId });
        return exists
            ? res.status(409).json({ message: "Product is out of stock" })
            : res.status(404).json({ message: "Product not found" });
    }
    await redisClient.del(cacheKey);
    await redisClient.del("allproduct:1");
    return res.status(200).json({ message: "Product purchased successfully", product: prod });
});

const initStock = AsyncHandler(async (req, res) => {
    const {prodId} = req.params;
    const cacheKey = `stock:${prodId}`;
    const prod = await product.findById(prodId);
    if (!prod) {
        return res.status(404).json({ message: "Product not found" });
    }
    await redisClient.set(cacheKey, prod.quantity, "EX", process.env.CACHE_TTL || 900, "NX");
    return res.status(200).json({ message: "Stock initialized", product: prod });
});

const deleteProduct = AsyncHandler(async (req, res) => {
    const { prodId } = req.params;
    const cacheKey = `product:${prodId}`;
    const prod = await product.findOneAndDelete({ _id: prodId });
    if (!prod) {
        return res.status(404).json({ message: "Product not found" });
    }
    await redisClient.del(cacheKey);
    await redisClient.del("allproduct:1");
    console.log("Product deleted and cache cleared");
    return res.status(200).json({ message: "Product deleted successfully" });
})


export { createProduct, getAllProducts, updateprice, updatequantity, deleteProduct, getProductById, buyProduct, initStock, buy_naive, buyProductRedis };