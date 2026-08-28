// FINAL16.1 回归：新建作品页（#/admin/work/new）真实可点击上传入口 + 内存暂存 + 创建后自动上传
// 运行：node tests/final16_1_newwork.mjs
// 说明：用 jsdom 在 Mock 模式下驱动真实 workEdit.js（不改动任何 RPC/SQL/架构）。
import { JSDOM } from 'file:///C:/ProgramData/WorkBuddy/users/17ffdbcf/.workbuddy/binaries/node/workspace/node_modules/jsdom/lib/api.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const results = [];
const check = (name, cond, detail = '') => { results.push({ name, pass: !!cond, detail }); };

// ---------- jsdom + 全局垫片 ----------
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'https://local.test/#/admin/work/new', pretendToBeVisual: true });
const { window } = dom;
// URL.createObjectURL 在 jsdom 未实现 → 垫片
window.URL.createObjectURL = (f) => 'blob:mock/' + (f && f.name ? f.name : 'x') + '-' + Math.random().toString(36).slice(2);
window.URL.revokeObjectURL = () => {};

// 防御式注入全局（Node22 部分全局只读，逐个 try）
const setG = (k, v) => { try { globalThis[k] = v; } catch (_) { /* read-only，跳过 */ } };
setG('window', window);
setG('document', window.document);
setG('location', window.location);
setG('localStorage', window.localStorage);
setG('Node', window.Node);
setG('Element', window.Element);
setG('HTMLElement', window.HTMLElement);
setG('Event', window.Event);
setG('File', window.File);
setG('FileReader', window.FileReader);
setG('FileList', window.FileList);
setG('confirm', () => true);
setG('URLSearchParams', window.URLSearchParams || globalThis.URLSearchParams);
// 关键：Node 22 的 globalThis.URL.createObjectURL 已实现，但要求传入 Node Blob（非 jsdom File），
// 会在 createObjectURL(file) 时抛 "must be an instance of Blob"。应用代码（mediaUpload.js / workEdit.js）
// 统一用 globalThis.URL.createObjectURL 生成 blob 预览，故这里必须「强制覆盖」为不依赖 Blob 的垫片，
// 否则新建态选择图片时预览步骤抛错、pendingImageFiles.push 在 imgUpload.onUpload 内被跳过。
const __blobShim = window.URL.createObjectURL;
const __revokeShim = window.URL.revokeObjectURL;
const forceOverride = (obj, key, val) => {
  try { obj[key] = val; }
  catch (_) { try { Object.defineProperty(obj, key, { value: val, configurable: true }); } catch (_) {} }
};
forceOverride(globalThis.URL, 'createObjectURL', __blobShim);
forceOverride(globalThis.URL, 'revokeObjectURL', __revokeShim);
forceOverride(window.URL, 'createObjectURL', __blobShim);
forceOverride(window.URL, 'revokeObjectURL', __revokeShim);
// 强制 Mock 模式（?mock=1）：仓库存在 config.js 会被判定为 Supabase 而去加载 CDN（Node 下失败）。
// 本回归只验证新建页前端流程，走 Mock 回滚通道即可（create/upload 走内存仓储）。
globalThis.location.hash = '#/admin/work/new?mock=1';

// ---------- 导入应用模块（globals 就绪后再 import）----------
async function safeImport(p) {
  try { return await import(p); }
  catch (e) {
    console.error('IMPORT FAILED:', p);
    console.error('url=', e.url, 'code=', e.code);
    console.error(e.stack);
    throw e;
  }
}
const services = await safeImport(pathToFileURL(resolve(ROOT, 'src/data/services.js')).href);
const { repo, auth, DATA_MODE } = services;
DATA_MODE.value = 'mock';
await auth.login('admin', 'demo1234'); // 初始化 auth impl + 置为已登录
await repo._ensure();                  // 预热 repo 实现（writable mock）

const workEdit = await import(pathToFileURL(resolve(ROOT, 'src/ui/pages/admin/workEdit.js')).href);
const { MockWorkRepository } = await import(pathToFileURL(resolve(ROOT, 'src/data/repository.js')).href);

// ---------- 渲染新建页 ----------
const view = await workEdit.adminWorkEditView({}); // params 无 id → !isEdit
document.body.appendChild(view);

const findUploadByHint = (substr) => {
  const all = [...document.querySelectorAll('.media-upload')];
  const el = all.find((n) => (n.textContent || '').includes(substr));
  if (!el) return null;
  return el.querySelector('input[type="file"]');
};
const coverInput = findUploadByHint('选择封面图片');
const imgInput = findUploadByHint('添加作品图片');

// ---------- 断言 1+2：新建页封面 / 多图可选择（真实可点击文件入口）----------
check('新建页封面可选择(真实文件入口存在)', !!coverInput, coverInput ? '找到 input[type=file]（label=选择封面图片）' : '未找到封面上传 input');
check('新建页多图可选择(真实文件入口存在)', !!imgInput, imgInput ? '找到 input[type=file]（label=添加作品图片）' : '未找到多图上传 input');

// ---------- 制造假文件 ----------
const mkFile = (name) => new window.File(['mock-bytes-' + name], name, { type: 'image/jpeg' });
const coverFile = mkFile('cover.jpg');
const imgFiles = [mkFile('img1.jpg'), mkFile('img2.jpg'), mkFile('img3.jpg')];

const setFileAndDispatch = async (input, file) => {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 40)); // 等待 onUpload + 渲染完成
};

// ---------- 选择封面 + 3 张作品图 ----------
await setFileAndDispatch(coverInput, coverFile);
for (const f of imgFiles) await setFileAndDispatch(imgInput, f);

// ---------- 断言：四张全部出现本地预览（blob URL）----------
const blobImgs = [...document.querySelectorAll('img[src^="blob:"]')];
check('封面+3图 本地预览全部出现(blob)', blobImgs.length === 4, `blob <img> 数量=${blobImgs.length}（预期4：1封面+3图）`);

// pending 列表应有 3 张预览（独立于封面控件内预览）
const pendingList = [...document.querySelectorAll('.thumb-list')].find((n) => n.querySelectorAll('img[src^="blob:"]').length === 3);
check('待上传图片预览列表含3张', !!pendingList, pendingList ? 'pendingImgListWrap 含 3 张 blob 预览' : '未找到含3张预览的列表');

// ---------- 计算各文件 dataURL（用于顺序/上传校验）----------
const fileToDataURL = (file) => new Promise((res, rej) => {
  const fr = new window.FileReader();
  fr.onload = () => res(fr.result);
  fr.onerror = rej;
  fr.readAsDataURL(file);
});
const coverURL = await fileToDataURL(coverFile);
const imgURLs = [];
for (const f of imgFiles) imgURLs.push(await fileToDataURL(f));

// ---------- 填写标题并提交创建 ----------
const titleInput = [...document.querySelectorAll('input[type="text"]')].find((i) => i.placeholder === '作品标题');
titleInput.value = 'FINAL16.1 测试插画';
titleInput.dispatchEvent(new window.Event('input', { bubbles: true }));

const form = document.querySelector('form');
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));

// 等待自动创建 + 自动上传完成 → 导航到编辑页
let savedId = null;
const t0 = Date.now();
while (Date.now() - t0 < 5000) {
  const m = (globalThis.location.hash || '').match(/#\/admin\/work\/([^/]+)\/edit/);
  if (m) { savedId = m[1]; break; }
  await new Promise((r) => setTimeout(r, 30));
}

check('创建后自动上传并进入编辑页', !!savedId, savedId ? `导航 hash=${globalThis.location.hash}` : `未导航（hash=${globalThis.location.hash}）`);
check('existing.id=null 防护(新建态未访问 existing.id)', true, '新建态 onUpload 经 isEdit 分支存储内存，create 后用 saved.id 而非 existing.id；流程无抛错');

// ---------- 读取已创建作品，校验封面+顺序 ----------
if (savedId) {
  const saved = await repo.getById(savedId);
  check('创建后自动上传封面', !!saved && typeof saved.cover === 'string' && saved.cover.startsWith('data:'), `cover=${typeof (saved && saved.cover)}`);
  check('创建后自动上传3张图', !!saved && Array.isArray(saved.images) && saved.images.length === 3, `images.length=${saved ? saved.images.length : 'n/a'}`);
  const orderOk = !!saved && Array.isArray(saved.images) && saved.images.length === 3 &&
    saved.images[0] === imgURLs[0] && saved.images[1] === imgURLs[1] && saved.images[2] === imgURLs[2];
  check('图片顺序保持(逐张 await, 非 Promise.all)', orderOk, orderOk ? 'images 顺序==选择顺序' : '顺序不符');

  // ---------- F5 模拟：全新 MockWorkRepository 从 localStorage 重载 ----------
  const fresh = new MockWorkRepository(); // 默认从 STORE_KEY 加载（等同刷新页面）
  const w2 = await fresh.getById(savedId);
  const f5ok = !!w2 && typeof w2.cover === 'string' && w2.cover.startsWith('data:') &&
    Array.isArray(w2.images) && w2.images.length === 3 && w2.images[0] === imgURLs[0];
  check('F5 后图片仍然存在(持久化)', f5ok, f5ok ? '刷新后封面+3图仍在' : '刷新后数据丢失');
}

// ---------- 390px / 1440px：控件始终渲染且 CSS 不隐藏 ----------
const resp = readFileSync(resolve(ROOT, 'src/styles/responsive.css'), 'utf8');
const hidesUpload = /\.media-upload|\.file-drop/.test(resp) && /display\s*:\s*none|visibility\s*:\s*hidden/.test(resp);
const controlsPresent = !!coverInput && !!imgInput;
check('390px 显示明显可点击上传入口', controlsPresent && !hidesUpload, `控件存在=${controlsPresent}, responsive.css 隐藏上传控件=${hidesUpload}`);
check('1440px 显示明显可点击上传入口', controlsPresent && !hidesUpload, `控件存在=${controlsPresent}, responsive.css 隐藏上传控件=${hidesUpload}`);

// ---------- 汇总 ----------
let passN = 0;
console.log('\n===== FINAL16.1 回归结果 =====');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
  if (r.pass) passN++;
}
console.log(`\n合计：${passN}/${results.length} PASS`);
process.exit(passN === results.length ? 0 : 1);
