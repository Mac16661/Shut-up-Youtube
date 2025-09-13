const mongoose = require("mongoose");

const batchSchema = new mongoose.Schema(
  {
    file_id: { type: String, required: true },          
    batch_id: { type: String, required: true },         
    status: { type: Number, default: 0, enum: [0, 1] },
    timestamp: { type: Date, default: Date.now }   
  },
  { versionKey: false }
);

module.exports = mongoose.model("Batch", batchSchema);
