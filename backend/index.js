const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const { connectToMongoDB } = require("./services/mongoService");
require("dotenv").config();

const youtubeRoute = require("./routes/youtubeRoute");

const app = express();
const PORT = process.env.PORT || 80; // TODO: Not require while deploying to cloud function
const URI = process.env.MONGODB;

// TODO: connect to mongoDB
connectToMongoDB(URI).then(() => console.log("MongoDB connected"));

// TODO: Basic rate limiter 20 quey per minute [ENV] (Need to fix it)
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 1000, // TODO: Need to change Limit each IP to 1000 requests per windowMs
});

// middleware
app.use(express.json());
app.use(helmet()); // adds http header to secure app
app.use(limiter); // rate limiter
app.use(cors()); // allow any origin

// routes
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date() });
});

// Routes
app.use("/api", youtubeRoute);

// TODO: Not required during cloud function deployment
// app.listen(PORT, () => {
//   console.log(`Server running on http://localhost:${PORT}`);
// });

exports.shutthefupp = app;
