const express = require('express');
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require('../db.js');
const {verifyTokenCookie} = require("../controllers/middlewareAuth.js");
const {categories, notificationsOrderDate, FilterCategories, getPost, shippingInfo, getCartAfterPurchase, notifications, addPost, getCart, deleteCart, getPosts,  getOrCreateCart, getshippingInfo, getShippingPrice, addPayment, addShippingPrice, purchasedStatus, addToCart, getOrderNumber, getReview, review, getNotifications, viewedNotifications, search} = require('../controllers/products.js');


router.use(verifyTokenCookie);
router.get("/", getPosts);
router.get("/categories", categories);
router.get("/getshippinginfo", getshippingInfo);
router.post("/shippinginfo", shippingInfo);
router.post("/addprice", addShippingPrice);
router.put("/addpayment", addPayment);
router.get("/shippingprice", getShippingPrice);
router.put("/productstatus", purchasedStatus);
router.get("/getordernumber", getOrderNumber)
router.post("/addtocart", addToCart);
router.get("/carts", getCart);
router.get("/search", search);
router.post("/review", review)
router.post("/notifications", notifications);
router.put("/viewed-notification", viewedNotifications);
router.get("/orderDate", notificationsOrderDate);
router.get("/get-notifications", getNotifications); 
router.get("/getcartsafterpurchase", getCartAfterPurchase);
router.get("/getreview/:id", getReview);
router.delete('/removecarts/:productId', deleteCart);
router.get('/categories/:categories', FilterCategories);
router.get("/:id", getPost);
router.post("/", addPost);
 

 


module.exports = router;