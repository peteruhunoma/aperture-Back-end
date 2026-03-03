const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: "mysql-aperture.alwaysdata.net",
    user: "aperture",
    password: "freezeDarius#1",
    database: "aperture_two",
    port:3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});
module.exports = pool;