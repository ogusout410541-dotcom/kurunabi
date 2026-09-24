// GitHub Pages に似せた確認用サーバー：すべて max-age=600 で返し、/__ver?v=X で「デプロイ」を切り替える
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.argv[2], PORT = Number(process.argv[3] || 7828);
let VER = null;   // null = そのまま
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__ver') { VER = u.searchParams.get('v'); res.writeHead(200, { 'Cache-Control': 'no-store' }); return res.end('ver=' + VER); }
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
  let body = fs.readFileSync(f);
  if (VER) {
    if (p.endsWith('js/app.js')) body = Buffer.from(String(body).replace(/HC\.VERSION = '[\d.]+'/, `HC.VERSION = '${VER}'`));
    if (p.endsWith('sw.js')) body = Buffer.from(String(body).replace(/const CACHE = 'kurunavi-v[\d.]+'/, `const CACHE = 'kurunavi-v${VER}'`));
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
  res.end(body);
}).listen(PORT, () => console.log('serving', ROOT, 'on', PORT));
