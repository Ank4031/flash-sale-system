import dbConnect from "./DB/db.js";
import express from "express";
import productrouter from "./router/product.route.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();

dbConnect();
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'Welcome to Docker BACKEND !!' });
});
app.use("/api/v1/products", productrouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
