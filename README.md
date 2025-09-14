# Shut up Youtube

**Intelligently blocks irrelevant YouTube recommendations in real time and keeps your home feed distraction-free.**

---

## 🚀 Overview
Shut up Youtube is a Chrome extension + backend system designed to make YouTube less distracting.  
It scans your home feed in real-time, identifies channels, and hides videos that don’t match your chosen categories.

---

## 🛠 How It Works
1. **Chrome Extension (client-side)**
   - Injects a content script into YouTube.
   - Watches for new video cards with a `MutationObserver`.
   - Extracts channel info (channel handle and channel name).
   - Uses a cache to avoid re-checking the same channel.
   - Queries the backend API for block/allow decisions.
   - Hides irrelevant video cards instantly.

2. **Backend API (server-side)**
   - Stores channel metadata and categories in a database.
   - Returns block/allow decisions to the extension.
   - Pushes newly discovered channels into the database for later processing.

3. **CRON Jobs (server-side)**
   - Run at specified intervals.
   - Identify new channels from the database and create batch files.
   - Send batch files to the llama 4 model hosted on Groq Cloud.
   - Check for completed batch jobs and update the database with results.

---

## 📂 Database design

###  Channel Schema 
| Field                 | Type      | Description                              |
|-----------------------|-----------|------------------------------------------|
| `_id`                 | ObjectId  | Primary key                              |
| `channel_name`        | String    | Channel name                             |
| `channel_handle`      | String    | Channel handle or ID (e.g. `@manuarora`) |
| `videos`              | Array   | Sample video IDs/metadata                  |
| `channel_categories`  | Array   | Array of category ID (`-1 = unknown`)      |
| `status`              | Integer | 0 = new, 1 = processing, 2 = processed     |
| `ts`                  | Date    | Last update timestamp                      |


###  Batch Schema 
| Field       | Type      | Description                              |
|-------------|-----------|------------------------------------------|
| `_id`       | ObjectId  | Primary key                              |
| `batch_id`  | String    | Batch id from groq cloud                 |
| `file_id`   | String    | Batch file id                            |    
| `status`    | Integer   | 0 = processing, 1 = processed            |
| `ts`        | Date      | Last update timestamp                    |

---

### High Level Design

![High Level Design](https://github.com/Mac16661/Shut-up-Youtube/blob/main/HLD.png?raw=true)



## 🔌 API Example

### Request
```json
{
  "action": "callAPI",
  "data": [
    {"idx": 1, "channel_name": "Manu Arora", "channel_id": "/@manuarora"},
    {"idx": 2, "channel_name": "Some Channel", "channel_id": "/channel/UCabc..."}
  ]
}
```

### Response
```json
{
  "data": {
    "result": [
      {"channel_name":"Manu Arora","channel_id":"/@manuarora","channel_category":0},
      {"channel_name":"Some Channel","channel_id":"/channel/UCabc...","channel_category":5}
    ]
  }
}
```
