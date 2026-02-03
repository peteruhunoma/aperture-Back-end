const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const verifyTokenCookie = async (req, res, next) => {
  console.log("Middleware called for:", req.path); 
  const token = req.cookies.control_cookies;
  console.log("Token present:", !!token); 
  
  if (!token) {
    console.log("No token found"); 
    return next();
  }

  try {
    const decoded = jwt.verify(token, 'pwduserkey');
    req.user = decoded;
    console.log("User set in middleware:", req.user); 
    next();
  } catch (e) {
    console.log("Token verification failed:", e.message); 
    return res.status(403).json({ error: 'Invalid token' });
  }
}

module.exports = {
  verifyTokenCookie
}