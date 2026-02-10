const { Pool } = require("pg");
require('dotenv').config();

const pool = new Pool({
    host: "localhost",
    user: "postgres",
    password: "",
    database: "aperture",
    port: 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
 

module.exports = pool;
