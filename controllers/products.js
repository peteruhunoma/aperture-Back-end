const pool = require('../db.js');
const cookieParser = require('cookie-parser');
const multiparty = require('multiparty');
const path = require('path');
const fs = require("fs");
const jwt = require('jsonwebtoken');
const guestSession = require("./shopper_login.js");
const {verifyTokenCookie} = require("./middlewareAuth.js");
const CryptoJS = require("crypto-js");

require('dotenv').config();
 

const getPosts = async (req, res) => {
  try {
    const bestSellerResult = await pool.query(`
      SELECT id,
             username,
             "productName",
             price,
             SPLIT_PART(media, ',', 1) AS media
      FROM   products
      ORDER  BY id DESC
      LIMIT  10
    `);
    const bestSeller = bestSellerResult.rows;

    const newArrivalResult = await pool.query(`
      SELECT id,
             username,
             "productName",
             price,
             SPLIT_PART(media, ',', 1) AS media
      FROM   products
      ORDER  BY date DESC
      LIMIT 10
    `);
    const newArrival = newArrivalResult.rows;

    const categoryResult = await pool.query(`
      SELECT p.id,
             p.category,
             p.username,
             p."productName",
             SPLIT_PART(p.media, ',', 1) AS media
      FROM (
        SELECT DISTINCT category
        FROM products
        ORDER BY RANDOM()
        LIMIT 10
      ) AS rnd
      JOIN products AS p ON p.category = rnd.category
      ORDER BY rnd.category, RANDOM()
      LIMIT 10
    `);
    const category = categoryResult.rows;

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
      SPLIT_PART(products.media, ',', 1) AS media,
      category, media AS "Media", price, "productDescription", "productName", date, id, uid, username, status
    `;

    if (!id || isNaN(id)) {
      return res.status(400).json({ message: "Invalid product ID" });
    }

    if (!token) {
      try {
        const q = `SELECT ${guestFields} FROM products WHERE id = $1`;
        const result = await pool.query(q, [id]);
        
        if (!result.rows || result.rows.length === 0) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        return res.status(200).json(result.rows[0]);
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
        const q = `SELECT ${guestFields} FROM products WHERE id = $1`;
        const result = await pool.query(q, [id]);
        
        if (!result.rows || result.rows.length === 0) {
          return res.status(404).json({ message: "Product not found" });
        }
        
        return res.status(200).json(result.rows[0]);
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

const addPost = async (req, res) => {
  try {
    const token = req.cookies.control_cookies;
    if (!token) return res.status(401).json("not authenticated");

    jwt.verify(token, "pwduserkey", async (err, userInfo) => {
      console.log(err);
      if (err) {
        if (err.name === "TokenExpiredError") {
          return res.status(401).json({ logout: true, message: "Session expired" });
        }  
        return res.status(403).json("Token invalid");
      }
      
      const q = `INSERT INTO products ("productName", "productDescription", media, category, price, uid, username, stock, date) 
                 VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`;

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

      const data = await pool.query(q, values);
      res.status(200).json(data.rows);
    });
  } catch (err) {
    res.status(500).json(err, "error checking");
  }
};

const categories = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM category");
    res.status(200).json(result.rows);   
    console.log(result.rows);
  } catch (err) {
    res.status(500).json(err, "could not connect");
    console.log(err, "categories");
  }
};

const FilterCategories = async (req, res) => {
  try {
    const loggedInUser = req.user?.res;
    const category = req.params.categories;
    if (!loggedInUser) {
      res.status(401).json("You are not logged in");
    }
    const result = await pool.query("SELECT * FROM products WHERE category = $1", [category]);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json(err);
  }
};

const getOrCreateCart = async (userId, guestSessionId) => {
  let cart;

  if (userId) {
    const result = await pool.query('SELECT id FROM carts WHERE user_id = $1', [userId]);
    cart = result.rows;
  } else {
    const result = await pool.query('SELECT id FROM carts WHERE session_id = $1', [guestSessionId]);
    cart = result.rows;
  }

  if (cart.length) {
    if (userId) {
      await pool.query('UPDATE carts SET session_id = NULL WHERE user_id = $1', [userId]);
    }
    return cart[0].id;
  }

  const res = await pool.query(
    'INSERT INTO carts (user_id, session_id) VALUES ($1, $2) RETURNING id',
    [userId || null, guestSessionId || null]
  );

  if (userId) {
    await pool.query('UPDATE carts SET session_id = NULL WHERE id = $1', [res.rows[0].id]);
  }

  return res.rows[0].id;
};

const addToCart = async (req, res) => {
  const { productId, quantity = 1 } = req.body;  
  if (!productId || quantity < 1) {
    return res.status(400).json({ error: 'Invalid product or quantity' });
  }

  try {
    const userId = req.user?.res?.id || null;
    const guestSessionId = req.guestSessionId;
    console.log(userId, "userid");

    const productsResult = await pool.query(
      'SELECT * FROM products WHERE id = $1',
      [productId]
    );
    const products = productsResult.rows;
    
    if (products.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    if (products[0].stock < quantity) {
      return res.status(400).json({ error: 'Insufficient stock' });
    }

    const cartId = await getOrCreateCart(userId, guestSessionId);

    const existingItemsResult = await pool.query(
      'SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2',
      [cartId, productId]
    );
    const existingItems = existingItemsResult.rows;

    if (existingItems.length > 0) {
      const newQuantity = existingItems[0].quantity + quantity;
      await pool.query(
        'UPDATE cart_items SET quantity = $1 WHERE cart_id = $2 AND product_id = $3',
        [newQuantity, cartId, productId]
      );
    } else {
      await pool.query(
        'INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)',
        [cartId, productId, quantity]
      );
    }

    const cartItemsResult = await pool.query(
      `SELECT SUM(quantity) as total_items 
       FROM cart_items 
       WHERE cart_id = $1`,
      [cartId]
    );
    const cartItems = cartItemsResult.rows;

    res.status(200).json({
      success: true,
      cartId,
      totalItems: cartItems[0].total_items || 0
    });

  } catch (error) {
    console.error('Add to cart error:', error);
    res.status(500).json({ error: 'Failed to add item to cart' });
  }
};

const getCart = async (req, res) => {
  try {
    const userId = req.user?.res?.id || null;
    const guestSessionId = req.guestSessionId;  
    const cartId = await getOrCreateCart(userId, guestSessionId);
    const purchased = false;

    const itemsResult = await pool.query(
      `SELECT 
         SPLIT_PART(p.media, ',', 1) AS media,
         ci.product_id,
         ci.quantity,
         p."productName",
         p.price,
         p.username,
         p.media AS "Media",
         (ci.quantity * p.price) as subtotal
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1 AND ci.purchased = $2`,
      [cartId, purchased]
    );
    const items = itemsResult.rows;

    console.log(cartId, "cartID");
    console.log(items, "items");
    
    const cartTotalResult = await pool.query(
      `SELECT SUM(ci.quantity * p.price) as total
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1 AND ci.purchased = $2`,
      [cartId, purchased]
    );
    const cartTotal = cartTotalResult.rows;

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
};

const getCartAfterPurchase = async (req, res) => {
  try {
    const orderNumber = req.query.orderNumber || req.body.orderNumber;
    const userId = req.user?.res?.id || null;
    const guestSessionId = req.guestSessionId;  
    const cartId = await getOrCreateCart(userId, guestSessionId);
    
    if (!orderNumber) {
      return res.status(400).json({ error: 'Order number is required' });
    }

    const itemsResult = await pool.query(
      `SELECT 
         SPLIT_PART(p.media, ',', 1) AS media,
         ci.product_id,
         ci.quantity,
         p."productName",
         p.price,
         p.username,
         p.media AS "Media",
         (ci.quantity * p.price) as subtotal
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1 AND ci."orderNumber" = $2`,
      [cartId, orderNumber]
    );
    const items = itemsResult.rows;

    console.log(cartId, "cartID");
    console.log(items, "items");
    
    const cartTotalResult = await pool.query(
      `SELECT SUM(ci.quantity * p.price) as total
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1 AND ci."orderNumber" = $2`,
      [cartId, orderNumber]
    );
    const cartTotal = cartTotalResult.rows;

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
};

const deleteCart = async (req, res) => {
  const { productId } = req.body;
  const userId = req.user?.res?.id || null;
  const guestSessionId = req.guestSessionId;

  try {
    const cartId = await getOrCreateCart(userId, guestSessionId);
    
    const deleteCartResult = await pool.query(
      'DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2 RETURNING *',
      [cartId, productId]
    );

    res.status(200).json(deleteCartResult.rows);
    console.log({deleteCart: deleteCartResult.rows, success: true});
  } catch (error) {
    console.error('Remove from cart error:', error);
    res.status(500).json({ error: 'Failed to remove item' });
  }
};

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

    const cartRowsResult = await pool.query(
      'SELECT id FROM carts WHERE user_id = $1',
      [loggedInUser.id]
    );
    const cartRows = cartRowsResult.rows;
    
    console.log(cartRows, "");
    if (!cartRows.length) {
      return res.status(404).json({ error: 'No cart found' });
    }

    const cartId = cartRows[0].id;

    await pool.query(
      `INSERT INTO shipping_address
       ("firstName", "lastName", address, city, "postalCode", country, "cartId", user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [firstName, lastName, address, city, postalCode, country, cartId, loggedInUser.id]
    );

    return res.status(201).json({ message: 'Shipping info saved' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Could not connect to server' });
  }
};

const getshippingInfo = async (req, res) => {
  try {
    const loggedInUser = req.user?.res || null; 
    if (!loggedInUser) {
      return res.status(401).json({ error: 'You are not logged in' });
    }

    const newShippingResult = await pool.query(
      `SELECT * FROM shipping_address WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, 
      [loggedInUser.id]
    );
    const newShippingAddress = newShippingResult.rows[0];
    
    const oldShippingResult = await pool.query(
      `SELECT * FROM ( 
         SELECT * FROM shipping_address WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2 
       ) AS x ORDER BY created_at ASC LIMIT 1`,
      [loggedInUser.id]
    );
    const oldShippingAddress = oldShippingResult.rows;
    
    console.log(oldShippingAddress, "old");
    res.status(200).json({newaddress: newShippingAddress, oldaddress: oldShippingAddress});
  } catch (err) {
    res.status(500).json("internal server error", err);
    console.log(err);
  }
};

const addShippingPrice = async (req, res) => {
  try {
    const {shippingPrice, grandTotal} = req.body;
    const loggedInUser = req.user?.res || null; 
    if (!loggedInUser) {
      return res.status(401).json({ error: 'You are not logged in' });
    }
    
    const cartsResult = await pool.query("SELECT id FROM carts WHERE user_id = $1", [loggedInUser.id]);
    const carts = cartsResult.rows;
    
    if (!carts.length) {
      res.status(400).json("no cart added");
    }
    
    const dataResult = await pool.query(
      "INSERT INTO payment_gateway (price, shipping_price, user_id, \"cartId\") VALUES($1, $2, $3, $4) RETURNING *",
      [grandTotal, shippingPrice, loggedInUser.id, carts[0].id]
    );
    const data = dataResult.rows;
    
    console.log(data);
    res.status(200).json(data);
  } catch (err) {
    console.log(err);
  }
};

const getShippingPrice = async (req, res) => {
  try {
    const loggedInUser = req.user?.res || null; 
    if (!loggedInUser) {
      return res.status(401).json({ error: 'You are not logged in' });
    }
    
    const olderShippingResult = await pool.query(
      "SELECT shipping_price, price FROM payment_gateway WHERE user_id = $1 ORDER BY paid_at DESC LIMIT 1", 
      [loggedInUser.id]
    );
    const olderShippingAddress = olderShippingResult.rows;
    
    res.status(200).json(olderShippingAddress);
  } catch (err) {
    res.status(500).json(err);
  }
};

const addPayment = async (req, res) => {
  try {
    const { cardNumber, expiration, cvc, cardholderName, orderId } = req.body; 
    const loggedInUser = req.user?.res || null; 
    if (!loggedInUser) {
      res.status(401).json("you are not logged in");
    }
    
    console.log(loggedInUser, "kils");
    const cartsResult = await pool.query("SELECT id FROM carts WHERE user_id = $1", [loggedInUser.id]);
    const carts = cartsResult.rows;
    const cartId = carts[0].id;
    
    const result = await pool.query(
      `UPDATE payment_gateway 
       SET "card_Number" = $1, expiration = $2, cvc = $3, "cardholder_Name" = $4, "orderNumber" = $5, username = $6 
       WHERE "cartId" = $7 AND paid_at = (
         SELECT MAX(paid_at) FROM payment_gateway WHERE "cartId" = $7
       ) RETURNING *`,
      [cardNumber, expiration, cvc, cardholderName, orderId, loggedInUser.username, carts[0].id]
    );
    
    const deleteRowsResult = await pool.query(
      `DELETE FROM payment_gateway 
       WHERE user_id = $1 AND "cartId" = $2 AND "card_Number" = $3 
       AND paid_at = (
         SELECT MAX(paid_at) FROM payment_gateway WHERE user_id = $1 AND "cartId" = $2 AND "card_Number" = $3
       ) RETURNING *`,
      [loggedInUser.id, carts[0].id, 0]
    );
    const deleteRows = deleteRowsResult.rows;
    
    console.log(result.rows, "reds");
    console.log(orderId);
    console.log(deleteRows, "dele");

    res.status(200).json({success: "payment successful", deleteRows});

  } catch (err) {
    res.status(500).json(err, "this is true");
  }
};

const purchasedStatus = async (req, res) => {
  const { orderId } = req.body;
  try {
    const loggedInUser = req.user || null; 
    if (!loggedInUser) {
      res.status(401).json("you are not logged in");
    }
    
    const purchased = req.body.purchased;
    const cartRowsResult = await pool.query('SELECT id FROM carts WHERE user_id = $1', [loggedInUser.id]);
    const cartRows = cartRowsResult.rows;
    const cartId = cartRows[0].id;
    
    console.log(cartId, "catrs");
    const statusResult = await pool.query(
      "UPDATE cart_items SET purchased = $1, \"orderNumber\" = $2, purchased_at = CURRENT_TIMESTAMP WHERE cart_id = $3 RETURNING *", 
      [purchased, orderId, cartId]
    );
    const status = statusResult.rows;
    
    res.status(200).json(status);
    console.log(status, cartId, "lp");
    console.log(status, "lut");
  } catch (err) {
    console.log(err, "np");
    res.status(500).json(err);
  }
};

const getOrderNumber = async (req, res) => {
  const loggedInUser = req.user?.res; 
  try {
    if (!loggedInUser) {
      res.status(401).json('You are not logged in');
    }
    
    const cartRowsResult = await pool.query('SELECT id FROM carts WHERE user_id = $1', [loggedInUser.id]);
    const cartRows = cartRowsResult.rows;
    const cartId = cartRows[0].id;
    
    const getOrderIdResult = await pool.query(
      'SELECT "orderNumber", paid_at FROM payment_gateway WHERE "cartId" = $1 ORDER BY paid_at DESC LIMIT 1', 
      [cartId]
    );
    const getOrderId = getOrderIdResult.rows;
    
    res.status(200).json(getOrderId);

  } catch (err) {
    res.status(500).json(err);
  }
};
 
const notificationsOrderDate = async (req, res) => {
  const orderNumber = req.query.orderNumber;
  const loggedInUser = req.user?.res; 
  try {
    if (!loggedInUser) {
      res.status(401).json('You are not logged in');
    }
    
    const cartRowsResult = await pool.query('SELECT id FROM carts WHERE user_id = $1', [loggedInUser.id]);
    const cartRows = cartRowsResult.rows;
    const cartId = cartRows[0].id;
    
    const getOrderIdResult = await pool.query(
      'SELECT paid_at FROM payment_gateway WHERE "cartId" = $1 AND "orderNumber" = $2', 
      [cartId, orderNumber]
    );
    const getOrderId = getOrderIdResult.rows;
    
    res.status(200).json(getOrderId);

  } catch (err) {
    res.status(500).json(err);
  }
};

const notifications = async (req, res) => {
  const loggedInUser = req.user?.res;
  const {orderNumber, date} = req.body;
  try {
    if (!loggedInUser) {
      res.status(401).json('you are not logged in');
    }
    
    console.log(orderNumber);
    const cartRowsResult = await pool.query('SELECT id FROM carts WHERE user_id = $1', [loggedInUser.id]);
    const cartRows = cartRowsResult.rows;
    const cartId = cartRows[0].id;
    
    const dataResult = await pool.query(
      'INSERT INTO notifications ("orderNumber", "cartId", "userId", ordered_at) VALUES($1, $2, $3, $4) RETURNING *', 
      [orderNumber, cartId, loggedInUser.id, date]
    );
    const data = dataResult.rows;
    
    res.status(200).json(data);
    console.log(data);
  } catch (err) {
    res.status(500).json(err);
    console.log(err);
  }
};

const viewedNotifications = async (req, res) => {
  const loggedInUser = req.user?.res;
  const {viewed, orderNumber} = req.body;
  try {
    if (!loggedInUser) {
      return res.status(401).json('you are not logged in');  
    }
    
    const cartRowsResult = await pool.query('SELECT id FROM carts WHERE user_id = $1', [loggedInUser.id]);
    const cartRows = cartRowsResult.rows;
    const cartId = cartRows[0].id;
    
    const dataResult = await pool.query(
      'UPDATE notifications SET viewed = $1 WHERE "userId" = $2 AND "orderNumber" = $3 RETURNING *', 
      [viewed, loggedInUser.id, orderNumber]
    );
    const data = dataResult.rows;
    
    const viewedDataResult = await pool.query(
      'SELECT viewed FROM notifications WHERE "orderNumber" = $1', 
      [orderNumber]
    );
    const viewedData = viewedDataResult.rows;
    
    res.status(200).json({data, viewed: viewedData});  
    console.log(data);
  } catch (err) {
    res.status(500).json(err);
    console.log(err);
  }
};

const getNotifications = async (req, res) => {
  const loggedInUser = req.user?.res;
  try {
    if (!loggedInUser) {
      res.status(401).json('you are not logged in');
    }
    
    const cartRowsResult = await pool.query('SELECT id FROM carts WHERE user_id = $1', [loggedInUser.id]);
    const cartRows = cartRowsResult.rows;
    const cartId = cartRows[0].id;
    
    const dataResult = await pool.query(
      'SELECT * FROM notifications WHERE "userId" = $1 AND "cartId" = $2', 
      [loggedInUser.id, cartId]
    );
    const data = dataResult.rows;
    
    res.status(200).json(data);
    console.log(data);
  } catch (err) {
    res.status(500).json(err);
    console.log(err);
  }
};

const getReview = async (req, res) => {
  try {
    const {id} = req.params;
    const loggedInUser = req.user;  
    console.log(id, "iji");
    
    if (!loggedInUser) {
      return res.status(401).json({ message: 'You are not logged in' });
    }
    
    const reviewsResult = await pool.query(
      `SELECT * FROM reviews WHERE "productId" = $1`, 
      [id]  
    );
    const reviews = reviewsResult.rows;
    
    console.log(reviews, "fetched reviews");
    res.status(200).json({ reviews, message: "Success" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

const review = async (req, res) => {
  const { id, review, rating, title } = req.body;
  console.log(review, rating, title, id, "djhdhjdh");
  
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
    
    const q = `INSERT INTO reviews (username, "reviewTitle", rating, review, "productId") 
               VALUES ($1, $2, $3, $4, $5) RETURNING *`;
    const result = await pool.query(q, values);
    
    console.log(result.rows, "datas");
    return res.status(200).json(result.rows);
    
  } catch (err) {
    return res.status(500).json(err);
  }
};

const search = async (req, res) => {
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
        "productName", 
        "productDescription", 
        media, 
        category, 
        price, 
        username, 
        uid, 
        date, 
        status, 
        stock 
      FROM products 
      WHERE 1=1
    `;
    
    const params = [];
    let paramIndex = 1;

    if (q && q.trim() !== '') {
      query += ` AND (
        "productName" ILIKE $${paramIndex} OR 
        "productDescription" ILIKE $${paramIndex + 1} OR 
        category ILIKE $${paramIndex + 2}
      )`;
      const searchTerm = `%${q}%`;
      params.push(searchTerm, searchTerm, searchTerm);
      paramIndex += 3;
    }

    if (category && category.trim() !== '') {
      query += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }

    if (minPrice) {
      query += ` AND price >= $${paramIndex}`;
      params.push(parseFloat(minPrice));
      paramIndex++;
    }
    
    if (maxPrice) {
      query += ` AND price <= $${paramIndex}`;
      params.push(parseFloat(maxPrice));
      paramIndex++;
    }

    if (status && status.trim() !== '') {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY 
      CASE 
        WHEN "productName" ILIKE $${paramIndex} THEN 1
        WHEN "productDescription" ILIKE $${paramIndex + 1} THEN 2
        ELSE 3
      END,
      date DESC
    `;
    const exactMatch = `%${q}%`;
    params.push(exactMatch, exactMatch);
    paramIndex += 2;

    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const productsResult = await pool.query(query, params);
    const products = productsResult.rows;

    let countQuery = `SELECT COUNT(*) as total FROM products WHERE 1=1`;
    const countParams = [];
    let countParamIndex = 1;

    if (q && q.trim() !== '') {
      countQuery += ` AND (
        "productName" ILIKE $${countParamIndex} OR 
        "productDescription" ILIKE $${countParamIndex + 1} OR 
        category ILIKE $${countParamIndex + 2}
      )`;
      const searchTerm = `%${q}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
      countParamIndex += 3;
    }

    if (category && category.trim() !== '') {
      countQuery += ` AND category = $${countParamIndex}`;
      countParams.push(category);
      countParamIndex++;
    }

    if (minPrice) {
      countQuery += ` AND price >= $${countParamIndex}`;
      countParams.push(parseFloat(minPrice));
      countParamIndex++;
    }
    
    if (maxPrice) {
      countQuery += ` AND price <= $${countParamIndex}`;
      countParams.push(parseFloat(maxPrice));
      countParamIndex++;
    }

    if (status && status.trim() !== '') {
      countQuery += ` AND status = $${countParamIndex}`;
      countParams.push(status);
      countParamIndex++;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = countResult.rows[0].total;

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
};
