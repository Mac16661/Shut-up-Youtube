const Channel = require("../models/channelSchema");

async function getChannelCategory(req, res) {
  try {
    console.log("yt controller:: ", req.body.length);

    const body = req.body;
    if (!Array.isArray(body)) {
      return res.status(400).json({ error: "Request body must be an array" });
    }

    // Filter valid input objects with necessary properties
    const filteredInput = body.filter(
      (item) => item && item.channel_id && item.channel_name
    );

    // Build $or query for Mongoose to find matching
    const filters = filteredInput.map((item) => ({
      channel_handle: item.channel_id,
      channel_name: item.channel_name,
    }));

    // Query MongoDB in bulk
    const foundChannels = await Channel.find({ $or: filters }).lean();

    // Create a map for quick lookup by compound key 'channel_id|channel_name'
    const channelMap = new Map();
    foundChannels.forEach((doc) => {
      const key = `${doc.channel_handle}|${doc.channel_name}`;
      channelMap.set(key, doc.channel_category);
      console.log(
        `DB Found: ${doc.channel_name} (${doc.channel_handle}) -> Category: ${doc.channel_category}`
      );
    });

    let result = [];
    let notFound = [];

    // Match input against DB results, split found and not found
    for (const item of body) {
      if (item && item.channel_id && item.channel_name) {
        const key = `${item.channel_id}|${item.channel_name}`;
        if (channelMap.has(key)) {
          result.push({
            ...item,
            channel_category: channelMap.get(key),
          });
        } else {
          // No record found in DB for this item
          result.push({
            ...item,
            channel_category: -1, // Default category for not found
          });
          notFound.push(item);
        }
      }
    }

    res.status(200).json({ result });

    // Background job: Insert not found channels
    insertChannelsInBackground(notFound);

    // const deleteResult = await  Channel.deleteMany({});
    // console.log(`Deleted ${deleteResult.deletedCount} documents from Channel collection.`);
  } catch (error) {
    console.error("Error in getChannelCategory:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function insertChannelsInBackground(notFound) {
  try {
    if (notFound.length === 0) return;

    // Prepare docs to insert with default values, status etc.
    const seen = new Set();
    const docsToInsert = notFound
      .filter((item) => {
        const key = `${item.channel_id}|${item.channel_name}`;
        if (seen.has(key)) {
          return false; // Skip duplicates
        }
        seen.add(key);
        return true;
      })
      .map((item) => ({
        channel_handle: item.channel_id,
        channel_name: item.channel_name,
      }));

    if (docsToInsert.length === 0) {
      console.log(
        "BACKGROUND JOB: No unique documents to insert after deduplication"
      );
      return;
    }

    console.log("NO OF DUPLICATES:: ", notFound.length - seen.size);

    // Insert many, ignoring duplicates to avoid errors (use 'ordered: false')
    const InsertResult = await Channel.insertMany(docsToInsert, {
      ordered: false,
      rawResult: true,
    }).catch((err) => {
      if (err.writeErrors) {
        // Filter errors that are not duplicate key errors
        const otherErrors = err.writeErrors.filter((e) => e.code !== 11000);
        if (otherErrors.length > 0) {
          console.error("Error inserting new channels:", otherErrors);
        }
        // else duplicate errors can be safely ignored
      } else if (err.code !== 11000) {
        // If it's not a bulk write error, but a single error other than duplicate
        console.error(
          "Error inserting new channels(other then duplicates):",
          err
        );
      }
    });
    console.log(
      "BACKGROUND JOB EXECUTED :: ",
      InsertResult?.insertedIds ? Object.keys(InsertResult.insertedIds).length : 0
    );
  } catch (bgError) {
    console.error("Background job error:", bgError);
  }
}

module.exports = { getChannelCategory };
