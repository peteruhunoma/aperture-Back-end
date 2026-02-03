const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require('../db.js');
const { login, register, logout } = require("../controllers/seller_login");

router.post("/sellerLogin", login);
router.post("/sellerSignup", register);
router.post("sellerlogout", logout);

module.exports = router;