import { Router } from "express";
import { createProduct, getAllProducts, updateprice, updatequantity, deleteProduct, getProductById, buyProduct, initStock } from "../controllers/product.controller.js";

const productrouter = Router();

productrouter.post("/add", createProduct);
productrouter.get("/all", getAllProducts);
productrouter.get("/get/:prodId", getProductById);
productrouter.put("/updateprice/:prodId", updateprice);
productrouter.put("/updatequantity/:prodId", updatequantity);
productrouter.delete("/delete/:prodId", deleteProduct);
productrouter.post("/buy/:prodId", buyProduct);
productrouter.get("/initstock/:prodId", initStock);

export default productrouter;