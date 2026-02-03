
const express = require('express')
const pool = require('../db.js');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {randomUUID} =  require('crypto');

const register = async  (req, res) =>{
   try{
  
   const username = req.body.username;
   const password = req.body.password;
   const date = req.body.date;
   const fullName = req.body.fullName;
   const email = req.body.email;
   const [existingEmail] = await pool.query('SELECT id from shopper_login WHERE email = ?  ', [email]);
   if(existingEmail.length > 0){
      return res.status(400).json("email already exist");  
   }
   const [existingUsername] = await pool.query('SELECT id from shopper_login WHERE username = ?', [username]);
   if(existingUsername.length > 0) {
    return res.status(400).json("username already exist");
   }
   if(!email || !username || !password || !fullName ) {
    return res.status(400).json("some or all field are empty");
   }
   if (username.length < 4){
    return res.status(400).json("username field has less than 4 characters");
   }
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    return res.status(400).json("invalid email format");
   }
   if (password.length < 6){
    return res.status(400).json('password is too short');
   }

   const salt = await bcrypt.genSalt(10);
   const hashpassword = await bcrypt.hash(password, salt);
   const [result] = await pool.query('INSERT INTO shopper_login (email, username, fullName, password, date) VALUES ( ?, ?, ?, ?, ?)', [email, username, fullName, hashpassword,  date]);
   res.status(200).json(result);
  console.log(result);
  }catch(err){
    res.status(500).json(err, "cannot connect to database");
    console.log(err);
  }
}  

const login = async (req, res) => {
  try {
    const emailOrUsername = req.body.emailOrUsername;
    const password = req.body.password;

    if (!emailOrUsername && !password) {
      return res.status(400).json("All fields are required");
    }
    if (!emailOrUsername) {
      return res.status(400).json("Email or username is required");
    }
    if (!password) {
      return res.status(400).json("Password is required");
    }

    const [data] = await pool.query(
      "SELECT * FROM shopper_login WHERE email = ? OR username = ?",
      [emailOrUsername, emailOrUsername]
    );

    if (data.length === 0) {
      return res.status(400).json("Invalid login information");
    }

    const isPasswordCorrect = await bcrypt.compare(password, data[0].password);
    
    if (!isPasswordCorrect) {
      return res.status(400).json("Password is wrong");
    }

    const picked = data[0];
    
    const token = jwt.sign(
      { res: picked, id: picked.id },
      'pwduserkey'
    );
    
    const { password: _, ...userData } = picked;
    
    res.cookie("control_cookies", token, {
      httpOnly: true,
      secure: false,
      sameSite: 'Lax'
    }).status(200).json(userData);
    
    console.log(userData);
    
  } catch (err) {
    res.status(500).json("Unable to connect to the database");
    console.log(err);
  }
}

const logout = async (req, res) => {
  res.clearCookie("control_cookies", {
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
    path: '/'
  }).status(200).json("user logged out");
}



const  guestSession = async (req, res, next) => {
  if (!req.cookies.guest_sid) {
    const sid = randomUUID();               
    res.cookie('guest_sid', sid, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,    
      sameSite: 'Lax'
    });
    req.guestSessionId = sid;
  } else {
    req.guestSessionId = req.cookies.guest_sid;
  }
  next();
}

const uploadUserImage = async (req, res) => {
  try {
    const loggedInUser = req.user; 
    const { filename } = req.body; 
    
    if (!loggedInUser) {
      return res.status(401).json({ error: "Not logged in" });
    }
    
    const id = loggedInUser.id; 
    
    const q = "UPDATE shopper_login SET userImage = ? WHERE id = ?";
    const [result] = await pool.query(q, [filename, id]);
    
    res.status(200).json({ success: true, filename, result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Database error" });
  }
};

const userImage = async(req, res) => {
  try {
    const loggedInUser = req.user; 
    const [data] = await pool.query("SELECT userImage FROM shopper_login WHERE id = ?", [loggedInUser.res.id]);
    res.status(200).json(data);
  }catch(err){
    res.status(500).json(err);
  }
}
module.exports = {
    register,
    login,
    logout,
    uploadUserImage,
    userImage,
    guestSession
}