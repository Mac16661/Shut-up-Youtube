const express = require("express");
const router = express.Router();

const {
  getChannelCategory
} = require("../controllers/youtubeController");

router.post( "/get/category", getChannelCategory );

module.exports = router;