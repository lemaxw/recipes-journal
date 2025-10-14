# 🍽️ Chebureki Recipe Site

A bilingual (🇷🇺 Russian / 🇮🇱 Hebrew) static recipe gallery.  
Supports two modes:  
1. **Local Mode** – runs on your computer for editing/testing.  
2. **Remote (AWS) Mode** – fully serverless deployment with Cognito + API Gateway + Lambda + S3 + CloudFront.

---

## 🧩 Directory Structure

```
.
├── assets/                     # JS, CSS, auth modules
├── images/                     # Local recipe images (mirrors S3)
├── data/                       # Recipe JSONs + index.json
├── index.html                  # Public homepage
├── admin.html                  # Admin interface (requires auth remotely)
├── server.js                   # Local development server (Express)
├── lambda_presign_and_save.py  # AWS Lambda backend
├── sync-s3.sh                  # Sync + CloudFront invalidation script
├── .s3ignore                   # Files excluded from upload
└── README.md
```

---

## 🏠 Local Mode (Development)

Use **Node.js + Express** to test the site locally, including admin editing, uploads, and recipe management — all without AWS.

### Requirements

- Node.js ≥ 18
- npm (comes with Node)

### Setup & Run

```bash
npm install
npm start
```

or:

```bash
node server.js
```

Local server:
- Serves static files (`index.html`, `admin.html`, assets, data, images)
- Handles `POST /upload`, `/save-recipe`, `/delete-recipe`, `/delete-object`
- Saves data under:
  - `./images/recipes/<id>/`
  - `./data/recipes/<id>.json`

Open your browser at:  
👉 [http://127.0.0.1:8000](http://127.0.0.1:8000)

---

## ☁️ Remote Mode (AWS)

Production deployment uses AWS for authentication, storage, and hosting.

| Layer | Service | Purpose |
|--------|----------|----------|
| Frontend | **S3 + CloudFront** | Static site + CDN |
| Auth | **Cognito User Pool** | Secure admin login (JWT Hosted UI) |
| API | **API Gateway (HTTP API)** | Verifies JWT & invokes Lambda |
| Backend | **Lambda (Python)** | Generates presigned URLs, manages recipes |
| Storage | **S3** | Stores images and recipe JSON |
| CDN | **CloudFront** | Caches content globally |

---

### 🔐 Authentication Flow

1. Admin opens `admin.html`.  
2. JavaScript checks for existing Cognito `id_token`.  
3. If missing → redirect to Cognito Hosted UI login.  
4. On successful login, Cognito redirects back to `admin.html#id_token=...`.  
5. JS stores the token and sends it with every API call:

   ```
   Authorization: Bearer <id_token>
   ```

6. API Gateway’s **JWT Authorizer** verifies:
   - `iss` = `https://cognito-idp.us-east-1.amazonaws.com/us-east-1_z2piburmn`
   - `aud` = your Cognito App Client ID  
7. Lambda executes request (upload/save/delete).

---

### ⚙️ Lambda Setup

**Handler:**  
`lambda_function.lambda_handler`

**Environment Variables:**
| Name | Example | Purpose |
|------|----------|----------|
| `BUCKET` | `chebureki` | Target S3 bucket |
| `AWS_REGION` | `us-east-1` | Region of deployment |

**Required IAM Permissions:**
```
s3:GetObject
s3:PutObject
s3:DeleteObject
s3:ListBucket
```

---

### 🌐 API Endpoints (via API Gateway → Lambda)

| Path | Method | Description |
|------|---------|-------------|
| `/upload-url` | POST | Returns presigned S3 PUT URL |
| `/save-recipe` | POST | Saves recipe JSON & updates index |
| `/delete-recipe` | POST | Deletes recipe + optional images |
| `/delete-object` | POST | Deletes a single image |

---

### 🧠 CORS (HTTP API)

| Setting | Value |
|----------|--------|
| Allowed origins | `https://chebureki.lemaxw.xyz` |
| Allowed methods | `POST, OPTIONS` |
| Allowed headers | `content-type, authorization` |
| Allow credentials | false |

---

## 🔁 Deployment Script (sync-s3.sh)

Automates S3 sync + selective CloudFront invalidation.

### Environment Variables

```bash
export AWS_CHEBUREKI_BUCKET=s3://chebureki
export AWS_CHEBUREKI_DISTRIBUTION_CLOUDFRONT_ID=E123456789ABC
export AWS_PROFILE=default
```

### Run Deployment

```bash
./sync-s3.sh
```

**What it does:**
1. Reads `.s3ignore` (like `.gitignore`)
2. Detects changed/deleted files (`--dryrun`)
3. Syncs actual changes
4. Invalidates only changed CloudFront paths

Example `.s3ignore`:
```
.git/*
node_modules/*
*.log
*.zip
.env
__pycache__/*
lambda_presign_and_save.py
server.js
sync-s3.sh
```

---

## 💡 Tips

- `isLocal()` in `admin.js` auto-detects local vs AWS mode.  
- **Presigned URLs** expire after 15 minutes.  
- **Cognito ID tokens** expire after 1 hour, auto-refresh via Hosted UI.  
- **Identity Pool** no longer required (pure JWT auth).  
- Use `sync-s3.sh` regularly to deploy updates and refresh cache.

---

## 🧭 Architecture Overview

```
          ┌──────────────┐
          │  Browser     │
          │(admin.html)  │
          └─────┬────────┘
                │
     if local   │        if remote
     ───────────┼──────────────────────────
                │
        ┌───────▼────────┐         ┌───────────────────┐
        │ server.js (dev)│         │ API Gateway (JWT) │
        │ local Express  │         │ validates Cognito │
        └───────┬────────┘         └─────────┬─────────┘
                │                            │
       ┌────────▼────────┐          ┌────────▼────────┐
       │ local JSON+img  │          │ Lambda backend  │
       │ (./data, ./img) │          │ updates S3 JSON │
       └─────────────────┘          └────────┬────────┘
                                            │
                                    ┌───────▼────────┐
                                    │   S3 Bucket    │
                                    │ data + images  │
                                    └───────┬────────┘
                                            │
                                    ┌───────▼────────┐
                                    │ CloudFront CDN │
                                    │ chebureki.lemaxw.xyz │
                                    └────────────────┘
```

---

## 📜 License

MIT License – feel free to adapt for your own bilingual cooking project 🍰
