const mongoose = require("mongoose");

const channelSchema = new mongoose.Schema(
  {
    channel_name: { type: String, required: true },
    channel_handle: { type: String, required: true },
    videos: { type: Array, default: [] },
    channel_categories: {
      type: [Number],
      enum: [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      default: [-1],
    },
    status: { type: Number, default: 0, enum: [0, 1, 2] },
    channel_id: { type: String },
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

channelSchema.index({ channel_name: 1 }, { unique: true });
channelSchema.index({ channel_handle: 1 }, { unique: true });

module.exports = mongoose.model("Channel", channelSchema);
