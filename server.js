import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
// plus multer/busboy for multipart routes if needed


// Optional local email via SMTP (configure if you want)
let transporter = null;
if (process.env.SMTP_HOST) {
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}


// Serve static site (index.html, assets/, data/, images/)
app.use(express.static(__dirname, { extensions: ["html"] }));

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

// Multer storage writes to paths that mirror S3 keys
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const key = (req.query.key || "").replace(/^\/+/, "");
    const dir = path.join(__dirname, path.dirname(key));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const key = (req.query.key || "").replace(/^\/+/, "");
    cb(null, path.basename(key));
  }
});
const upload = multer({ storage });

// Upload file to local "S3"
app.post("/upload", upload.single("file"), (req, res) => {
  return res.json({ ok: true, key: req.query.key });
});

// Save/merge recipe JSON and update index.json
app.post("/save-recipe", (req, res) => {
  const { recipeJson, indexPatch } = req.body || {};
  if (!recipeJson?.id) return res.status(400).json({ error: "missing id" });

  const recipePath = path.join(__dirname, `data/recipes/${recipeJson.id}.json`);
  ensureDir(path.dirname(recipePath));
  fs.writeFileSync(recipePath, JSON.stringify(recipeJson, null, 2), "utf8");

  const indexPath = path.join(__dirname, "data/recipes/index.json");
  ensureDir(path.dirname(indexPath));
  let idx = [];
  if (fs.existsSync(indexPath)) {
    try { idx = JSON.parse(fs.readFileSync(indexPath, "utf8")); } catch {}
  }
  let found = false;
  idx = idx.map((x) => {
    if (x.id === indexPatch.id) { found = true; return indexPatch; }
    return x;
  });
  if (!found) idx.push(indexPatch);
  fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2), "utf8");

  res.json({ ok: true, id: recipeJson.id });
});

// Delete a recipe (and optionally images)
app.post("/delete-recipe", (req, res) => {
  const { id, deleteImages } = req.body || {};
  if (!id) return res.status(400).json({ error: "missing id" });

  const recipePath = path.join(__dirname, `data/recipes/${id}.json`);
  if (fs.existsSync(recipePath)) fs.unlinkSync(recipePath);

  const indexPath = path.join(__dirname, "data/recipes/index.json");
  if (fs.existsSync(indexPath)) {
    let idx = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    idx = idx.filter((x) => x.id !== id);
    fs.writeFileSync(indexPath, JSON.stringify(idx, null, 2), "utf8");
  }

  if (deleteImages) {
    const dir = path.join(__dirname, `images/recipes/${id}`);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  res.json({ ok: true, id });
});

// Delete one object by key
app.post("/delete-object", (req, res) => {
  const { key } = req.body || {};
  if (!key) return res.status(400).json({ error: "missing key" });
  const p = path.join(__dirname, key.replace(/^\/+/, ""));
  if (!p.startsWith(__dirname)) return res.status(400).json({ error: "bad key" });
  if (fs.existsSync(p)) fs.unlinkSync(p);
  res.json({ ok: true, key });
});

app.post('/contact', async (req, res) => {
  try {
    const { name, email, phone = "", message, website, ua, lang, page } = req.body || {};
    if (website) return res.json({ ok: true });
    if (!phone && !email) return res.status(400).json({ error: 'invalid input' });

    const cleanPhone = (phone || '').toString().replace(/[^0-9+\-\s()]/g, '').slice(0, 30); // NEW

    const ts = Date.now();
    const outDir = path.join(__dirname, 'data', 'contacts');
    fs.mkdirSync(outDir, { recursive: true });
    const record = { ts, name, email, phone: cleanPhone, message, ua, lang, page }; // NEW
    fs.writeFileSync(path.join(outDir, `${ts}.json`), JSON.stringify(record, null, 2), 'utf8');

    if (transporter && process.env.MAIL_TO && process.env.MAIL_FROM) {
      await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: process.env.MAIL_TO,
        subject: `[Recipes Journal] New message from ${name}`,
        text:
`Name: ${name}
Email: ${email}
Phone: ${cleanPhone || '-'}
Lang: ${lang}
Page: ${page}
UA: ${ua}
Time: ${ts}

Message:
${message}`,
        replyTo: email
      });
    } else {
      console.log('[CONTACT]', record);
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Local server on http://127.0.0.1:${PORT}`));
