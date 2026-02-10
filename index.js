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


app.get('/favicon.ico', (req, res)=>{
  res.status(204).end();
})
app.post('/uploaduserimg', (req, res) => {
  const form = new multiparty.Form({
    uploadDir: path.join(__dirname, '../client/aperture/public/uploadeduser'),
  });

  form.parse(req, (err, fields, files) => {
    if (err) return res.status(500).send('Upload error');

    const uploadedFile = files.image?.[0]; // assuming <input name="file" />

    if (!uploadedFile) {
      return res.status(400).send("No file uploaded");
    }
    
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];

    if (!allowedTypes.includes(uploadedFile.headers['content-type'])) {
      // Remove the unwanted file
      fs.unlinkSync(uploadedFile.path);
      return res.status(400).send('only image format');
    }

    const newFilename = path.basename(uploadedFile.path);

    res.send(newFilename); // ⬅️ return just the filename as a string
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
    
    // Setup directories
    const publicDir = path.join(__dirname, '../client/aperture/public');
    const userDir = path.join(publicDir, userInfo.res.username);
    
    // Verify public directory exists
    if (!fs.existsSync(publicDir)) {
      return res.status(500).json({ 
        error: 'Public directory does not exist',
        path: publicDir
      });
    }
    
    // Create user directory
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
      console.log('✓ Created user directory:', userInfo.res.username);
    }
    
    // Parse form data first to get productName
    const form = new multiparty.Form({ 
      uploadDir: userDir, // Temporary upload to user directory
      maxFilesSize: 90 * 1024 * 1024, // 50MB total limit
      maxFiles: 5 // Maximum 5 files
    });
    
    form.parse(req, async (parseErr, fields, files) => {
      if (parseErr) {
        console.error('Parse error:', parseErr);
        return res.status(500).json({ 
          error: 'Upload error', 
          details: parseErr.message 
        });
      }
      
      // Extract productName from fields (multiparty returns arrays)
      const productName = fields.productName ? fields.productName[0] : null;
      
      if (!productName) {
        // Clean up uploaded files
        if (files.images) {
          files.images.forEach(file => {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          });
        }
        return res.status(400).json({ error: "Product name is required" });
        
      }
      
      console.log('Product Name:', productName);
      
      try {
        // Query database
        const productQ = await pool.query(
          "SELECT `ProductName` FROM products WHERE username = ? AND `productName` = ?", 
          [userInfo.res.username, productName]
        );
        
        console.log(productQ, "Database query result");
        
        // Create product directory
        const productDir = path.join(userDir, productName);
        
        if (!fs.existsSync(productDir)) {
          fs.mkdirSync(productDir, { recursive: true });
          console.log('✓ Created product directory:', productName);
        }
        
        // Get uploaded images
        const uploadedImages = files.images || [];
        
        if (uploadedImages.length === 0) {
          return res.status(400).json({ error: "No files uploaded" });
        }
        
        if (uploadedImages.length > 5) {
          // Clean up all uploaded files
          uploadedImages.forEach(file => {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          });
          return res.status(400).json({ error: "Maximum 5 images allowed" });
        }
        
        const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
        const processedFilenames = [];
        
        // Process each uploaded file
        for (const uploadedFile of uploadedImages) {
          // Check file type
          if (!allowedTypes.includes(uploadedFile.headers['content-type'])) {
            // Clean up all uploaded files
            uploadedImages.forEach(file => {
              if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
              }
            });
            return res.status(400).json({ 
              error: 'Only image formats (JPEG, PNG, JPG) allowed' 
            });
          }
          
          // Move file from userDir to productDir
          const oldPath = uploadedFile.path;
          const newFilename = path.basename(uploadedFile.path);
          const newPath = path.join(productDir, newFilename);
          
          // Move the file
          fs.renameSync(oldPath, newPath);
          
          processedFilenames.push(newFilename);
          console.log('✓ Upload successful:', newFilename);
        }
        
        // Return comma-separated list of filenames
        const result = processedFilenames.join(',');
        console.log('✓ All uploads complete:', result);
        
        res.status(200).json({ 
          success: true,
          filenames: result,
          fileCount: processedFilenames.length
        });
        
      } catch (dbErr) {
        console.error('Database error:', dbErr);
        
        // Clean up uploaded files on error
        if (files.images) {
          files.images.forEach(file => {
            if (fs.existsSync(file.path)) {
              fs.unlinkSync(file.path);
            }
          });
        }
        
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



pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});




app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });