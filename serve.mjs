// ============================================================
// serve.mjs — 零依赖静态服务器（保证正确的 MIME，避免模块加载失败）
// 用法：node serve.mjs  或  PORT=8080 node serve.mjs
// ============================================================
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, relative } from 'node:path';

const root = resolve(process.cwd());
const port = Number(process.env.PORT) || 5173;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    // 先把 URL pathname 转成「项目根目录下的相对路径」，再 resolve。
    // 否则以 / 开头的路径（如 /index.html）会被 resolve 当作系统绝对路径（C:\index.html 等），
    // 既取不到文件、又会误判为越界返回 403。
    const relPath = p.replace(/^\/+/, '');
    const filePath = resolve(root, relPath);
    // 目录边界：用 relative(root, filePath) 判定，只拒绝真正的 .. 越界与绝对越界
    const rel = relative(root, filePath);
    if (rel.startsWith('..')) { res.writeHead(403); res.end('Forbidden'); return; }
    const s = await stat(filePath).catch(() => null);
    if (!s || s.isDirectory()) { res.writeHead(404); res.end('Not found'); return; }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500); res.end('Server error');
  }
});

server.listen(port, () => console.log(`\n  QIU YUZHEN 艺术作品集运行中 →  http://localhost:${port}\n  按 Ctrl+C 停止。\n`));
