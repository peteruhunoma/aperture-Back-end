const pool = require('../db.js');
const cookieParser = require('cookie-parser');
const multiparty = require('multiparty');
const path = require('path');
const fs = require("fs");
const jwt = require('jsonwebtoken');
const guestSession = ("./shopper_login.js");
const {verifyTokenCookie} = require("./middlewareAuth.js");
const CryptoJS = require("crypto-js");

require('dotenv').config();


const getPosts = async (req, res) => {
  try {
    const [bestSeller] = await pool.query(`
      SELECT id,
             username,
             productName,
             price,
             SUBSTRING_INDEX(media, ',', 1) AS media
      FROM   products
      ORDER  BY id DESC
      LIMIT  10
    `);

    const [newArrival] = await pool.query(`
      SELECT id,
             username,
             productName,
             price,
             SUBSTRING_INDEX(media, ',', 1) AS media
      FROM   products
      ORDER  BY \`date\` DESC
      LIMIT 10
    `);

    const [category] = await pool.query(`
    SELECT p.id,
    p.category,
    p.username,
    p.productName,
    SUBSTRING_INDEX(p.media, ',', 1) AS media
FROM (
 SELECT DISTINCT category
 FROM products
 ORDER BY RAND()
 LIMIT 10
) AS rnd
JOIN products AS p ON p.category = rnd.category
ORDER BY rnd.category, RAND()
LIMIT 10`);

    return res.status(200).json({
      bestSeller:  bestSeller, 
      newArrival:  newArrival,
      category:  category
    });

  } catch (err) {
    console.error('getPosts error:', err);
    return res.status(500).json({ msg: 'Server error' });
  }
};

const getPost = async (req, res) => {
  try {
    const id = req.params.id;
    const token = req.cookies.control_cookies;

    const guestFields = `
      SUBSTRING_INDEX(products.media, ',', 1) AS media,
      Category, Media, Price, ProductDescription, ProductName, date, id, uid, username, status
    `;

    if (!id || isNaN(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    if (!token) {
      try {
        const q = `SELECT ${guestFields} FROM products WHERE id = ?`;
        const [rows] = await pool.query(q, [id]);
        
        if (!rows || rows.length === 0) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        return res.status(200).json(rows[0]);
      } catch (dbErr) {
        console.error("Database query error (guest):", dbErr);
        return res.status(500).json({ 
          message: "Database error", 
          error: dbErr.message 
        });
      }
    }

    jwt.verify(token, "pwduserkey", async (err, userInfo) => {
      if (err) {
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({ logout: true, message: "Session expired" });
        }
        return res.status(403).json({ message: "Token invalid" });
      }

      try {
        const q = `SELECT ${guestFields} FROM products WHERE id = ?`;
        const [rows] = await pool.query(q, [id]);
        
        if (!rows || rows.length === 0) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        return res.status(200).json(rows[0]);
      } catch (dbErr) {
        console.error("Database query error (authenticated):", dbErr);
        return res.status(500).json({ 
          message: "Database error", 
          error: dbErr.message 
        });
      }
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      message: "Unable to process request", 
      error: err.message 
    });
  }
};

const addPost = async  (req, res) =>{
    try{
    const token = req.cookies.control_cookies;
    if(!token) return res.status(401).json("not authenticated");

    jwt.verify(token, "pwduserkey", async (err, userInfo) =>{
        console.log(err);
        if (err) {
            if (err.name === "TokenExpiredError") {
              return res.status(401).json({ logout: true, message: "Session expired" });
            }  
            return res.status(403).json("Token invalid");
        }
        const q = "INSERT INTO products (`ProductName`, `ProductDescription`, `Media`, `Category`, `Price`, `uid`,  `username`, `stock`, `date` ) VALUES(?)";

        const values = [
            req.body.productName,
            req.body.productDescription,
            req.body.media,
            req.body.category,
            req.body.price,
            userInfo.res.id,
            userInfo.res.username,
            req.body.stock,
            req.body.date
        ];

         const data = await pool.query(q,[values]);
         res.status(200).json(data);
            
        

    });
}catch(err){
    res.status(500).json(err, "error checking");
}

}

const categories = async (req, res) => {
    try{
    
    const [rows] = await pool.query("SELECT * FROM category");
  
    res.status(200).json(rows);   
           
    console.log(rows)

    }catch(err){
      res.status(500).json(err, "could not connect");
      console.log(err, "categories");
    }
}

const FilterCategories = async (req, res) =>{
try{
  const loggedInUser = req.user?.res;
  const category = req.params.categories;
  if(!loggedInUser){
    res.status(401).json("You are not logged in");
  }
  const categories = await pool.query("SELECT * FROM products WHERE category= ? ", [category]);
  res.status(200).json(categories);


}catch(err){
 res.status(500).json(err);
}
}
 


 
const getOrCreateCart = async (userId, guestSessionId) => {
  let cart;

  if (userId) {
    [cart] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);
  } else {
    [cart] = await pool.query('SELECT id FROM carts WHERE session_id = ?', [guestSessionId]);
  }

  if (cart.length) {
    if (userId) {
      await pool.query('UPDATE carts SET session_id = NULL WHERE user_id = ?', [userId]);
    }
    return cart[0].id;
  }

  const [res] = await pool.query(
    'INSERT INTO carts (user_id, session_id) VALUES (?, ?)',
    [userId || null, guestSessionId || null]
  );

  if (userId) {
    await pool.query('UPDATE carts SET session_id = NULL WHERE id = ?', [res.insertId]);
  }

  return res.insertId;
};
const addToCart  =  async (req, res) => {
  const { productId, quantity = 1 } = req.body;  
  if (!productId || quantity < 1) {
    return res.status(400).json({ error: 'Invalid product or quantity' });
  }

  try {
    const userId = req.user?.res?.id || null;
    const guestSessionId = req.guestSessionId;
    console.log(userId, "userid");

    const [products] = await pool.query(
      'SELECT * FROM products WHERE id = ?',
      [productId]
    );
    
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (products[0].stock < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    const cartId = await getOrCreateCart( userId, guestSessionId);

    const [existingItems] = await pool.query(
      'SELECT quantity FROM cart_items WHERE cart_id = ? AND product_id = ?',
      [cartId, productId]
    );

     if (existingItems.length > 0) {
      const newQuantity = existingItems[0].quantity + quantity;
      await pool.query(
        'UPDATE cart_items SET quantity = ? WHERE cart_id = ? AND product_id = ?',
        [newQuantity, cartId, productId]
      );
    } else {
      await pool.query(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)',
        [cartId, productId, quantity]
      );
    }

    const [cartItems] = await pool.query(
      `SELECT SUM(quantity) as total_items 
       FROM cart_items 
       WHERE cart_id = ?`,
      [cartId]
    );

    res.status(200).json({
      success: true,
      cartId,
      totalItems: cartItems[0].total_items || 0
    });

  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ error: 'Failed to add item to cart' });
  }
}


const getCart =  async (req, res) => {
  
  try {
    
    const userId = req.user?.res?.id || null;
    const guestSessionId = req.guestSessionId;  
    const cartId = await getOrCreateCart( userId, guestSessionId);
    const purchased = false;

    const [items] = await pool.query(
      `SELECT 
         SUBSTRING_INDEX(p.media, ',', 1) AS media,
         ci.product_id,
         ci.quantity,
         p.ProductName,
         p.Price,
         p.username,
         p.Media,
         (ci.quantity * p.price) as subtotal
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = ? AND ci.purchased = ? `,
      [cartId, purchased]
    );

    console.log(cartId, "cartID");
    console.log(items, "items");
    
    const [cartTotal] = await pool.query(
      `SELECT SUM(ci.quantity * p.price) as total
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = ? AND ci.purchased = ?`,
      [cartId, purchased]
    );

    res.status(200).json({
      items,
      subtotal: cartTotal[0].total || 0,
      cartId
    });
    
    console.log(items);
    console.log(cartTotal);
    

  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
}

const getCartAfterPurchase =  async (req, res) => {
  
  try {
    const orderNumber = req.query.orderNumber || req.body.orderNumber;
    const userId = req.user?.res?.id || null;
    const guestSessionId = req.guestSessionId;  
    const cartId = await getOrCreateCart( userId, guestSessionId);
    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required' });
    }

    const [items] = await pool.query(
      `SELECT 
         SUBSTRING_INDEX(p.media, ',', 1) AS media,
         ci.product_id,
         ci.quantity,
         p.ProductName,
         p.Price,
         p.username,
         p.Media,
         (ci.quantity * p.price) as subtotal
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = ? AND ci.orderNumber = ? `,
      [cartId, orderNumber]
    );

    console.log(cartId, "cartID");
    console.log(items, "items");
    
    const [cartTotal] = await pool.query(
      `SELECT SUM(ci.quantity * p.price) as total
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = ? AND ci.orderNumber = ?`,
      [cartId, orderNumber]
    );

    res.status(200).json({
      items,
      subtotal: cartTotal[0].total || 0,
      cartId
    });
    
    console.log(items);
    console.log(cartTotal);
    

  } catch (error) {
    console.error('Get cart error:', error);
    res.status(500).json({ error: 'Failed to fetch cart' });
  }
}


const deleteCart =  async (req, res) => {
  const { productId } = req.body;
  const userId = req.user?.res?.id || null;
  const guestSessionId = req.guestSessionId;

  try {
    const cartId = await getOrCreateCart(userId, guestSessionId);
    
    const deleteCart = await pool.query(
      'DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?',
      [cartId, productId]
    );

    res.status(200).json(deleteCart);
    console.log({deleteCart, success:true});
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ error: 'Failed to remove item' });
  }
}

const shippingInfo = async (req, res) => {
  try {
    const loggedInUser = req.user?.res || null;    
    if (!loggedInUser) {
      return res.status(401).json({ error: 'You are not logged in' });
    }

    const { firstName, lastName, postalCode, address, city, country } = req.body;
    if (!firstName || !lastName || !postalCode || !address || !city || !country) {
      return res.status(400).json({ error: 'All shipping fields are required' });
    }
    console.log(loggedInUser.id);

    const [cartRows] = await pool.query(
      'SELECT id FROM carts WHERE user_id = ?',
      [loggedInUser.id]
    );
    console.log(cartRows, "");
    if (!cartRows.length) {
      return res.status(404).json({ error: 'No cart found' });
    }

    const cartId = cartRows[0].id;

    await pool.query(
      `INSERT INTO shipping_address
       (firstName, lastName, address, city, postalCode, country, cartId, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [firstName, lastName, address, city, postalCode, country, cartId, loggedInUser.id]
    );

    return res.status(201).json({ message: 'Shipping info saved' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not connect to server' });
  }
}

const getshippingInfo = async (req, res) => {
try{
  const loggedInUser = req.user?.res || null; 
  if (!loggedInUser) {
    return res.status(401).json({ error: 'You are not logged in' });
  }



  const [rows] = await pool.query(`SELECT * FROM shipping_address WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`, [loggedInUser.id]);
  const newShippingAddress = rows[0];
  const [oldShippingAddress] =  await pool.query(`SELECT * FROM ( SELECT * FROM shipping_address WHERE user_id = ? ORDER BY created_at DESC LIMIT 2 ) AS x ORDER BY created_at ASC LIMIT 1;`,[loggedInUser.id]);
  console.log(oldShippingAddress,"old");
  res.status(200).json({newaddress: newShippingAddress, oldaddress: oldShippingAddress});
  }catch(err){
    res.status(500).json("internal server error", err);
    console.log(err);
  }

}

const addShippingPrice = async ( req, res) => {
  try{
    const {shippingPrice, grandTotal} = req.body;
    const loggedInUser = req.user?.res || null; 
    if (!loggedInUser) {
      return res.status(401).json({ error: 'You are not logged in' });
    }
    const [carts] = await pool.query("SELECT id FROM carts WHERE user_id = ?", [loggedInUser.id]);
    if(!carts.length) {
      res.status(400).json("no cart added");
    }
    
    const [data] =  await pool.query("INSERT INTO payment_gateway (price, shipping_price, user_id, cartId) VALUES(?, ?, ?, ?)",[grandTotal, shippingPrice, loggedInUser.id,  carts[0].id]);
    console.log(data);
    res.status(200).json(data);
  }catch(err){
     console.log(err);
  }
}
const getShippingPrice = async (req, res) => {
 try{
  const loggedInUser = req.user?.res || null; 
  if (!loggedInUser) {
    return res.status(401).json({ error: 'You are not logged in' });
  }
  const [olderShippingAddress] = await pool.query("SELECT shipping_price, price FROM payment_gateway WHERE user_id = ? ORDER BY paid_at DESC LIMIT 1", [loggedInUser.id]);
  res.status(200).json(olderShippingAddress);
 }catch(err){
  res.status(500).json(err);
 }
}
const addPayment = async ( req, res) => {
  try{
  const { cardNumber, expiration, cvc, cardholderName, orderId } = req.body; 
  const loggedInUser = req.user?.res || null; 
  if(!loggedInUser){
    res.status(401).json("you are not logged in");
  }
  console.log(loggedInUser,"kils");
  const [carts] = await pool.query("SELECT id FROM carts WHERE user_id = ?", [loggedInUser.id]);
  const cartId = carts[0].id;
  const [result] = await pool.query("UPDATE payment_gateway SET Card_Number = ?, Expiration = ?, CVC = ?, Cardholder_Name = ?, orderNumber = ?, username = ? WHERE  cartId = ? ORDER BY paid_at DESC LIMIT  1",[cardNumber, expiration, cvc, cardholderName, orderId, loggedInUser.username, carts[0].id]);
  const [deleteRows] = await pool.query("DELETE FROM payment_gateway WHERE user_id = ? AND cartId = ? AND  Card_Number = ? ORDER BY paid_at DESC LIMIT  1;;", [loggedInUser.id, carts[0].id, 0]);
console.log(result, "reds");
console.log(orderId);
console.log(deleteRows, "dele")

res.status(200).json({success: "payment successful", deleteRows});

}catch(err){
    res.status(500).json(err, "this is true");
}


}

const purchasedStatus = async (req, res) => {
  const { orderId } = req.body;
  try{
  const loggedInUser = req.user || null; 
  if(!loggedInUser){
    res.status(401).json("you are not logged in");
  }
  const purchased = req.body.purchased;
  const [cartRows] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [loggedInUser.id]);
  const cartId = cartRows[0].id;
  console.log(cartId,"catrs");
  const [status] = await pool.query("UPDATE cart_items SET purchased = ?, orderNumber = ?, purchased_at = CURRENT_TIMESTAMP WHERE cart_id = ?", [purchased, orderId, cartId]);
  res.status(200).json(status);
  console.log(status, cartId, "lp");
  console.log(status, "lut");
  }catch(err){
    console.log(err, "np");
    res.status(500).json(err);
  }

}


const getOrderNumber = async (req, res) => {
  const loggedInUser = req.user?.res; 
  try{
    if(!loggedInUser){
      res.status(401).json('You are not logged in');
    }
    const [cartRows] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [loggedInUser.id]);
    const cartId = cartRows[0].id;
    const [getOrderId] = await pool.query('SELECT orderNumber, paid_at FROM payment_gateway WHERE cartId = ? ORDER BY paid_at DESC LIMIT 1', [cartId]);
    res.status(200).json(getOrderId);

  }catch(err){
    res.status(500).json(err);
  }
  

}
 
const notificationsOrderDate = async (req, res) => {
  const orderNumber = req.query.orderNumber;
  const loggedInUser = req.user?.res; 
  try{
    if(!loggedInUser){
      res.status(401).json('You are not logged in');
    }
    const [cartRows] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [loggedInUser.id]);
    const cartId = cartRows[0].id;
    const [getOrderId] = await pool.query('SELECT  paid_at FROM payment_gateway WHERE cartId = ? AND orderNumber = ?', [cartId, orderNumber]);
    res.status(200).json(getOrderId);

  }catch(err){
    res.status(500).json(err);
  }
  

}

const notifications = async (req, res) => {
  const loggedInUser = req.user?.res;
  const {orderNumber, date } = req.body;
  try{
    if(!loggedInUser){
      res.status(401).json('you are not logged in');
    }
    console.log(orderNumber);
    const [cartRows] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [loggedInUser.id]);
    const cartId = cartRows[0].id;
    const [data] = await pool.query('INSERT INTO notifications (orderNumber, cartId, userId, ordered_at) VALUES(?, ?, ?, ?)', [orderNumber, cartId, loggedInUser.id, date]);
    res.status(200).json(data);
    console.log(data);
  }catch(err){
    res.status(500).json(err);
    console.log(err);

  }
}

const viewedNotifications = async (req, res) => {
  const loggedInUser = req.user?.res;
  const {viewed, orderNumber} = req.body;
  try{
    if(!loggedInUser){
      return res.status(401).json('you are not logged in');  
    }
    const [cartRows] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [loggedInUser.id]);
    const cartId = cartRows[0].id;
    const [data] = await pool.query('UPDATE notifications SET viewed = ? WHERE userId = ? AND orderNumber = ?', [viewed, loggedInUser.id, orderNumber]);
    const [viewedData] = await pool.query('SELECT viewed FROM notifications WHERE orderNumber = ?', [orderNumber]); // Changed 'viewed' to 'viewedData'
    res.status(200).json({data, viewed: viewedData});  
    console.log(data);
  }catch(err){
    res.status(500).json(err);
    console.log(err);
  }
}


const getNotifications = async (req, res) => {
  const loggedInUser = req.user?.res;
  try{
    if(!loggedInUser){
      res.status(401).json('you are not logged in');
    }
    const [cartRows] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [loggedInUser.id]);
    const cartId = cartRows[0].id;
    const [data] = await pool.query('SELECT * FROM notifications WHERE userId = ? AND cartId = ?', [loggedInUser.id, cartId]);
    res.status(200).json(data);
    console.log(data);
  }catch(err){
    res.status(500).json(err);
    console.log(err);

  }
}

const getReview = async (req, res) => {
  
  try {
  const {id} = req.params;
  const loggedInUser = req.user;  
 console.log(id, "iji")
    if (!loggedInUser) {
      return res.status(401).json({ message: 'You are not logged in' });
    }
    
    const [reviews] = await pool.query(
      `SELECT * FROM reviews WHERE productId = ?`, 
      [id]  
    );
    
    console.log(reviews, "fetched reviews");
    res.status(200).json({ reviews, message: "Success" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};



const review = async (req, res) => {
  const { id, review, rating, title } = req.body;
  console.log(review,  rating, title, id, "djhdhjdh");
  
  const loggedInUser = req.user; 

  try {
    if (!loggedInUser) {
      return res.status(401).json('You are not logged in');
    }
    
    
    const values = [
      loggedInUser.res.username,  
      title,
      rating,
      review,
      id
    ];
    
    const q = "INSERT INTO reviews (username, reviewTitle, rating, review, productId) VALUES (?, ?, ?, ?, ?)";
    const [result] = await pool.query(q, values);
    
    console.log(result, "datas");
    return res.status(200).json(result);
    
  } catch (err) {
    return res.status(500).json(err);
  }
};

const search =  async (req, res) => {
  try {
    const { 
      q = '', 
      category = '', 
      minPrice = 0, 
      maxPrice = 999999, 
      status = '',
      limit = 20,
      offset = 0 
    } = req.query;

    let query = `
      SELECT 
        id, 
        ProductName, 
        ProductDescription, 
        Media, 
        Category, 
        Price, 
        username, 
        uid, 
        date, 
        status, 
        stock 
      FROM products 
      WHERE 1=1
    `;
    
    const params = [];

    if (q && q.trim() !== '') {
      query += ` AND (
        ProductName LIKE ? OR 
        ProductDescription LIKE ? OR 
        Category LIKE ?
      )`;
      const searchTerm = `%${q}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (category && category.trim() !== '') {
      query += ` AND Category = ?`;
      params.push(category);
    }

    if (minPrice) {
      query += ` AND Price >= ?`;
      params.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      query += ` AND Price <= ?`;
      params.push(parseFloat(maxPrice));
    }

    if (status && status.trim() !== '') {
      query += ` AND status = ?`;
      params.push(status);
    }

    query += ` ORDER BY 
      CASE 
        WHEN ProductName LIKE ? THEN 1
        WHEN ProductDescription LIKE ? THEN 2
        ELSE 3
      END,
      date DESC
    `;
    const exactMatch = `%${q}%`;
    params.push(exactMatch, exactMatch);

    query += ` LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [products] = await pool.execute(query, params);

    let countQuery = `SELECT COUNT(*) as total FROM products WHERE 1=1`;
    const countParams = [];

    if (q && q.trim() !== '') {
      countQuery += ` AND (
        ProductName LIKE ? OR 
        ProductDescription LIKE ? OR 
        Category LIKE ?
      )`;
      const searchTerm = `%${q}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    if (category && category.trim() !== '') {
      countQuery += ` AND Category = ?`;
      countParams.push(category);
    }

    if (minPrice) {
      countQuery += ` AND Price >= ?`;
      countParams.push(parseFloat(minPrice));
    }
    if (maxPrice) {
      countQuery += ` AND Price <= ?`;
      countParams.push(parseFloat(maxPrice));
    }

    if (status && status.trim() !== '') {
      countQuery += ` AND status = ?`;
      countParams.push(status);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      success: true,
      data: products,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < total
      }
    });

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      message: 'Error searching products',
      error: error.message
    });
  }
};


 
module.exports = {
    getPosts,
    getPost,
    addPost,
    addToCart,
    getCart,
    getOrCreateCart,
    deleteCart,
    shippingInfo,
    getshippingInfo,
    addShippingPrice,   
    addPayment,
    purchasedStatus,
    getShippingPrice,
    getOrderNumber,
    getCartAfterPurchase,
    notifications,
    FilterCategories,
    categories,
    getReview,
    review,
    notificationsOrderDate,
    getNotifications,
    viewedNotifications,
    search
}