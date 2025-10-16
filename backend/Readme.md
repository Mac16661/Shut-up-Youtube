## How To Run

```bash
node index.js # In production

npm run dev # In development
```

## 🚀 Deployment Guide (Google Cloud Functions)

### ⚡ Pre-requisite

- Before deploying, **comment out `app.listen(...)`** in your backend code.  
  (Cloud Functions automatically handles this, so you don’t need it.)

---

### 📦 How to Deploy

From your backend folder, run:

```bash
gcloud functions deploy shutthefupp `
   --gen2 `
   --region=asia-south1 `
   --runtime=nodejs20 `
   --trigger-http `
   --allow-unauthenticated `
   --memory=256Mi `
   --timeout=30s `
   --max-instances=10 `
   --min-instances=0

```

### Future scope

Test container with at least 10 concurrent requests
