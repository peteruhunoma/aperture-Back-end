const express = require('express');
const router = express.Router();
const jwt = require("jsonwebtoken");
const pool = require('../db.js');
const register = require("../controllers/shopper_login.js");


router.post("/login", register.login );
router.post("/register", register.register);
router.post("/logout", register.logout);
router.put("/uploadimg", register.uploadUserImage);
router.get("/img", register.userImage);

module.exports = router;