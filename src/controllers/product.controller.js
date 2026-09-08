import { product } from "../models/product.model.js";
import AsyncHandler from "../utilities/AsyncHandler.js";
import {redisClient} from "../cache/redis.js";

const createProduct = AsyncHandler(async (req, res) => {
    const {name, description, price, quantity} = req.body;
    const newProduct = await product.create({name, description, price, quantity});
    console.log("New product created");
    res.status(201).json(newProduct);
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

export { createProduct, getAllProducts, updateprice, updatequantity, deleteProduct, getProductById };