const { Pool } = require("pg");
require('dotenv').config();

const pool = new Pool({
    user: 'postgres',
    host: 'db.ambzrigctcmrshdvnvlo.supabase.co',
    database: 'postgres',
    password: '#freezeDarius1',
    port: 6543,
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000, // 10 second timeout
    options: '-c search_path=public'
  });
 
module.exports = pool;
