const mongoose = require("mongoose");
require("dotenv").config();

const DB_NAME = process.env.DB_NAME 
mongoose.set("strictQuery", true);

async function connectToMongoDB(url) {
    return await mongoose.connect(url, {dbName: DB_NAME});
}

module.exports = {
    connectToMongoDB,
};