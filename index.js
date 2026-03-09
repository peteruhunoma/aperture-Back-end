const express = require("express");
const favicon = require("serve-favicon");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require('jsonwebtoken');
const shopper_login = require('./routes/shopper_login.js');
const seller_login = require('./routes/seller_login.js');
const products = require('./routes/products.js');
const pool = require('./db.js');
const multer = require('multer');
const multiparty = require('multiparty');
const path = require('path');
const busboy = require('busboy');
const fs = require("fs");
const cloudinary = require('./cloudinary.js');
const {verifyTokenCookie} = require("./controllers/middlewareAuth.js");
const { guestSession} = require("./controllers/shopper_login.js");

require('dotenv').config();

const port = process.env.PORT || 3000;


const app = express();

                                                  
app.use(cors(
  {origin: 'http://localhost:5173', 
credentials: true}));
app.use(cookieParser());
app.use(express.json()); 
app.use(verifyTokenCookie);
app.use(guestSession);


app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
})

app.post('/uploaduserimg', (req, res) => {
  const form = new multiparty.Form();

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).send('Upload error');

    const uploadedFile = files.image?.[0];

    if (!uploadedFile) {
      return res.status(400).send("No file uploaded");
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];

    if (!allowedTypes.includes(uploadedFile.headers['content-type'])) {
      fs.unlinkSync(uploadedFile.path);
      return res.status(400).send('only image format');
    }

    try {
      const result = await cloudinary.uploader.upload(uploadedFile.path, {
        folder: 'public/uploadeduser', // ✅ nested under public
      });

      fs.unlinkSync(uploadedFile.path);
      res.send(result.secure_url);

    } catch (uploadErr) {
      if (fs.existsSync(uploadedFile.path)) fs.unlinkSync(uploadedFile.path);
      res.status(500).send('Cloudinary upload error');
    }
  });
});


app.post('/upload', async (req, res) => {
  const token = req.cookies.control_cookies;

  if (!token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  jwt.verify(token, "pwduserkey", async (err, userInfo) => {
    if (err) {
      console.log('JWT Error:', err);
      return res.status(403).json({ error: "Invalid token" });
    }

    console.log('User Info:', userInfo);

    const form = new multiparty.Form({
      maxFilesSize: 90 * 1024 * 1024,
      maxFiles: 5
    });

    form.parse(req, async (parseErr, fields, files) => {
      if (parseErr) {
        console.error('Parse error:', parseErr);
        return res.status(500).json({
          error: 'Upload error',
          details: parseErr.message
        });
      }

      const productName = fields.productName ? fields.productName[0] : null;

      if (!productName) {
        if (files.images) {
          files.images.forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          });
        }
        return res.status(400).json({ error: "Product name is required" });
      }

      console.log('Product Name:', productName);

      const cleanupTemp = () => {
        if (files.images) {
          files.images.forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
          });
        }
      };

      try {
        const productQ = await pool.query(
          "SELECT `ProductName` FROM products WHERE username = ? AND `productName` = ?",
          [userInfo.res.username, productName]
        );

        console.log(productQ, "Database query result");

        const uploadedImages = files.images || [];

        if (uploadedImages.length === 0) {
          return res.status(400).json({ error: "No files uploaded" });
        }

        if (uploadedImages.length > 5) {
          cleanupTemp();
          return res.status(400).json({ error: "Maximum 5 images allowed" });
        }

        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        const processedUrls = [];

        // ✅ Check if public/{username} folder exists, create if not
        const userFolder = `public/${userInfo.res.username}`;
        try {
          await cloudinary.api.sub_folders(userFolder);
          console.log(`✓ Folder "${userFolder}" already exists`);
        } catch (folderErr) {
          if (folderErr.error?.http_code === 404) {
            await cloudinary.api.create_folder(userFolder);
            console.log(`✓ Created folder "${userFolder}"`);
          }
        }

        for (const uploadedFile of uploadedImages) {
          if (!allowedTypes.includes(uploadedFile.headers['content-type'])) {
            cleanupTemp();
            return res.status(400).json({
              error: 'Only image formats (JPEG, PNG, JPG) allowed'
            });
          }

          // ✅ Upload to public/{username}/{productName}
          const result = await cloudinary.uploader.upload(uploadedFile.path, {
            folder: `public/${userInfo.res.username}/${productName}`,
          });

          fs.unlinkSync(uploadedFile.path);

          processedUrls.push(result.secure_url);
          console.log('✓ Upload successful:', result.secure_url);
        }

        const result = processedUrls.join(',');
        console.log('✓ All uploads complete:', result);

        res.status(200).json({
          success: true,
          filenames: result,
          fileCount: processedUrls.length
        });

      } catch (dbErr) {
        console.error('Database error:', dbErr);
        cleanupTemp();
        return res.status(500).json({
          error: 'Database query failed',
          details: dbErr.message
        });
      }
    });
  });
});

 



 






app.use('/api/auth', shopper_login);
app.use('/api/sellerAuth', seller_login);
app.use(guestSession);
app.use(verifyTokenCookie);
app.use('/posts', products);



 module.exports = app;