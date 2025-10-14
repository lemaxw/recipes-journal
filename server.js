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

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Local server on http://127.0.0.1:${PORT}`));
