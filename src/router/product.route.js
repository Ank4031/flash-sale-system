import { Router } from "express";
import { createProduct, getAllProducts, updateprice, updatequantity, deleteProduct, getProductById } from "../controllers/product.controller.js";

const productrouter = Router();

productrouter.post("/add", createProduct);
productrouter.get("/all", getAllProducts);
productrouter.get("/get/:prodId", getProductById);
productrouter.put("/updateprice/:prodId", updateprice);
productrouter.put("/updatequantity/:prodId", updatequantity);
productrouter.delete("/delete/:prodId", deleteProduct);

export default productrouter;