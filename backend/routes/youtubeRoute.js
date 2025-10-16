const express = require("express");
const router = express.Router();

const {
  getChannelCategory,
  insertChannels
} = require("../controllers/youtubeController");

router.post( "/get/category", getChannelCategory );

// TODO: Add new route to save channel form the search page 
router.post( "/post/channels", insertChannels);

module.exports = router;