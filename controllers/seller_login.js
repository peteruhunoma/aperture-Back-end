const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const pool = require("../db.js");
const cookieParser = require("cookie-parser");

const register = async (req, res) => {
  try {
    const username = req.body.username;
    const fullName = req.body.fullName;
    const email = req.body.email;
    const password = req.body.password;
    const defaultProfileImage = "default.jpg";
    const date = req.body.date;
    
    const existingShopperEmailResult = await pool.query("SELECT email FROM shopper_login WHERE email = $1", [email]);
    const existingShopperEmail = existingShopperEmailResult.rows;
    
    if (existingShopperEmail.length > 0) {
      return res.status(404).json("email already exist");
    }
    
    const existingShopperUsernameResult = await pool.query("SELECT username FROM shopper_login WHERE username = $1", [username]);
    const existingShopperUsername = existingShopperUsernameResult.rows;
    
    if (existingShopperUsername.length > 0) {
      return res.status(404).json("user already exist");
    } 
    
    const existingUsernameResult = await pool.query("SELECT username FROM seller_login WHERE username = $1", [username]);
    const existingUsername = existingUsernameResult.rows;
    
    if (existingUsername.length > 0) {
      return res.status(404).json("user already exist");
    }
    
    const existingEmailResult = await pool.query("SELECT email FROM seller_login WHERE email = $1", [email]);
    const existingEmail = existingEmailResult.rows;
    
    if (existingEmail.length > 0) {
      return res.status(404).json("email already exist");
    }
    
    if (!fullName || !username || !email || !password) {
      return res.status(400).json("some or all fields are empty");
    }
    
    if (username.length < 4) {
      return res.status(400).json("username must be more than 4 characters");
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json("invalid email format");
    }
    
    if (password.length < 6) {
      return res.status(400).json("password is too short");
    }
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    console.log(password);
    console.log(hashedPassword);
    
    const registerUserResult = await pool.query(
      'INSERT INTO seller_login (email, username, full_name, password, "userImage", date) VALUES($1, $2, $3, $4, $5, $6) RETURNING *', 
      [email, username, fullName, hashedPassword, defaultProfileImage, date]
    );
    const registerUser = registerUserResult.rows;
    
    res.status(200).json(registerUser);
    console.log(registerUser);
    
  } catch (err) {
    res.status(500).json("could not connect to database", err);
    console.log(err);
  }
};

const login = async (req, res) => {
  try {
    const emailOrUsername = req.body.emailOrUsername;
    const password = req.body.password;
    
    if (!emailOrUsername || !password) {
      return res.status(400).json("all fields are empty");
    }
    
    const selectLoginChoiceResult = await pool.query(
      "SELECT * FROM seller_login WHERE username = $1 OR email = $2", 
      [emailOrUsername, emailOrUsername]
    );
    const selectLoginChoice = selectLoginChoiceResult.rows;
    
    console.log(selectLoginChoice);
    
    if (selectLoginChoice.length === 0) {
      return res.status(404).json("email or username invalid");
    }
    
    const isPasswordCorrect = await bcrypt.compare(password, selectLoginChoice[0].password); 
    
    if (!isPasswordCorrect) {
      return res.status(400).json("password is wrong");
    }
    
    const token = jwt.sign({res: selectLoginChoice[0]}, "sellerAperturecookieLock", {expiresIn: "1d"});
    
    const {password: _, ...userData} = selectLoginChoice[0];
    
    res.cookie("sellerAperturecookieRT", token, {
      httpOnly: true,
      secure: false,
      sameSite: "Lax"
    }).status(200).json(userData);
    
    console.log(userData);
    
  } catch (err) {
    res.status(500).json("could not connect to the database", err);
  }
};

const logout = async (req, res) => {
  res.clearCookie("sellerAperturecookieRT", {
    httpOnly: true,
    sameSite: "none",
    secure: true,
  }).status(200).json("loggedout");
};
 
module.exports = {
  register,
  login,
  logout,
};
