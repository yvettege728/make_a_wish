// server.js — Railway 部署入口
// 把所有 Supabase 调用都放在 server 端,前端不再接触 SUPABASE_KEY
// 需要的环境变量(在 Railway 后台填):
//   SUPABASE_URL    例如 https://bwsbxmzreztslmxouzrg.supabase.co
//   SUPABASE_KEY    Supabase 的 service_role key 或 anon key
//                  (注意!不是 sb_publishable 那种 key,要去 Settings > API 找 anon 或 service_role)

const express = require('express');
const path = require('path');
const multer = require('multer');

const app = express();
app.use(express.json({ limit: '5mb' }));

// 静态文件托管(index.html 和其他资源)
app.use(express.static(path.join(__dirname, '.')));

// ── 配置 ──────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TABLE = 'wishes';
const STORAGE_BUCKET = 'wish-photos';

// 启动前自检
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[FATAL] SUPABASE_URL 和 SUPABASE_KEY 环境变量必须设置');
  console.error('在 Railway 后台 Variables 面板里添加这两个变量后重新部署');
  process.exit(1);
}
console.log('[Boot] Supabase URL:', SUPABASE_URL);
console.log('[Boot] Key prefix:', SUPABASE_KEY.slice(0, 10) + '...');

// ── 健康检查端点(用来排查问题) ──────────────────
app.get('/api/health', async (req, res) => {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?limit=1`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });
    const text = await r.text();
    res.json({
      ok: r.ok,
      supabaseStatus: r.status,
      supabaseUrl: SUPABASE_URL,
      keyPrefix: SUPABASE_KEY.slice(0, 10),
      table: TABLE,
      sampleResponse: text.slice(0, 500)
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── GET /api/wishes — 读取所有 wishes(按时间倒序) ──
app.get('/api/wishes', async (req, res) => {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE}?order=created_at.desc&select=*`;
    const r = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    if (!r.ok) {
      const text = await r.text();
      console.error('[GET /api/wishes] Supabase error:', r.status, text);
      return res.status(r.status).send(text);
    }
    const data = await r.json();
    res.json(data);
  } catch (err) {
    console.error('[GET /api/wishes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/wishes — 写入新 wish ──
app.post('/api/wishes', async (req, res) => {
  try {
    const url = `${SUPABASE_URL}/rest/v1/${TABLE}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(req.body)
    });
    if (!r.ok) {
      const text = await r.text();
      console.error('[POST /api/wishes] Supabase error:', r.status, text);
      return res.status(r.status).send(text);
    }
    const data = await r.json();
    res.status(201).json(data);
  } catch (err) {
    console.error('[POST /api/wishes]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/upload — 图片上传到 Supabase Storage(中转) ──
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no file' });
    const objectPath = req.body.path || `misc/${Date.now()}-${req.file.originalname}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${objectPath}`;
    const r = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'x-upsert': 'false',
        'Content-Type': req.file.mimetype || 'application/octet-stream'
      },
      body: req.file.buffer
    });
    if (!r.ok) {
      const text = await r.text();
      console.error('[POST /api/upload] Storage error:', r.status, text);
      let hint = text;
      if (text.includes('Bucket not found')) {
        hint = `Storage bucket "${STORAGE_BUCKET}" 不存在。去 Supabase > Storage 新建一个 public bucket,名字叫 ${STORAGE_BUCKET}`;
      }
      return res.status(r.status).json({ error: hint });
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${objectPath}`;
    res.json({ publicUrl, objectPath });
  } catch (err) {
    console.error('[POST /api/upload]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 兜底:未匹配的路由返回 index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Boot] Make a Wish server running on port ${PORT}`);
});
