# FINAL16.3-SIMPLE AB PERFORMANCE CUTOVER — 交付报告

**状态：`CODE COMPLETE / GATE 75 PASS / PENDING 真人实测耗时`**
（自动化 Gate 已全绿；publish/unpublish/delete 的「真人网络耗时」需用客户正式账号在真机/手机网络实测，本环境无凭据无法执行。）

---

## 1. 产品契约（硬性）

- **A（公共前台）**：anonymous，只展示 `is_public=true`，无任何编辑能力。
- **B（管理员登录）**：增/删/改/排序/上传/替换/精选/发布。
- **A 与 B 读同一套 Supabase 数据**；B 保存/发布后 A 刷新立即同步。

---

## 2. 关键改造（已落实）

1. **停止跨 bucket 媒体搬运**：新上传直接进入 `portfolio-public`（随机不可预测路径）；禁止 `private→public` / `public→private` copy、`prepare_asset_*`、`publish_asset`/`unpublish_asset`、浏览器 `download→upload` 搬运。旧 RPC/migration 保留历史兼容不删，但**正式前端活调用次数 = 0**（见 §4 全局 RPC 审计）。
2. **发布/下架只控可见性**：`publish` = `works.is_public=true`（前置校验有封面、漫画≥1页）；`unpublish` = `is_public=false`；不移动/复制/删除任何 Storage 媒体。
3. **接受 Storage 取舍**：草稿仅由 `is_public` 标志 + A 公开查询 + A 详情路由隐藏；不要求草稿媒体文件本身强 Storage 私密隔离。
4. **历史 private 媒体只读兼容**：repository 读取继续兼容 `portfolio-private` 与 `portfolio-public`。
5. **上传变真正单次传输**：6 类上传方法（`uploadWorkCover`/`addWorkImage`/`replaceWorkImage`/`addComicPage`/`replaceComicPageImage`/`replaceCertificateImage`）只 `upload` 一次到 `portfolio-public`，再 `insert media_assets` / `link FK` / `append RPC`；无第二遍下载+上传。
6. **发布/下架禁止完整 hydrate**：`publishWork()` 成功直接返回 `{id, public:true}`；`unpublishWork()` 返回 `{id, public:false}`；UI 本地合并公开状态。
7. **单图删除禁止完整 hydrate**：`removeWorkImage()` 成功后 repository 返回 `{id, ok:true}`，无 `getById`；RPC 返回剩余 id，UI 本地删除该稳定 id 并保持其余相对顺序连续规范化。漫画同理（用 `_readComicPagesOrdered`）。
8. **后台预览并行**：`workEdit.renderImages()` 由串行 `for…await adminPreviewSrc` 改为 `Promise.all` 一次并行取得全部预览 URL，再严格按 `imagesState` 原顺序渲染。
9. **整作品删除极速**：单次删除 = 管理员校验一次 + 事务（`is_public=false` → 删 `work_images` → 删 `comic_pages` → 删 `works`），不搬 Storage、不物理删底层 `media_assets`/Storage（保留备份）。
10. **即时反馈**：上传显示文件名+大小（>8MB 提示「图片较大，上传可能需要较长时间」）；发布/下架/删除均显示进行中态 + 按钮 busy 锁。
11. **手机网络专项**：固定版本 `@supabase/supabase-js` 2.112.3 UMD 纳入本地 `vendor/`，`index.html` 以 `<script defer>` 加载，后台运行不再依赖 `cdn.jsdelivr.net` 动态 ESM。
12. **图片尺寸**：最大仍 10MB 不自动有损压缩；上传前显示文件名+大小。

---

## 3. 回归 Gate（`tests/final16_3_simple_ab.mjs`，纯 node + 注入式 fake Supabase）

**结果：75 PASS / 0 FAIL（exit 0）**

覆盖：
- publish 期间 Storage 上传=0 / 下载=0
- unpublish 期间 Storage 传输=0
- delete（整作品）Storage 传输=0，且 1 张图 vs 50 张图均 =0（不随图片 MB/张数增长）
- 单图删除不完整 hydrate（0 次 table select，返回 `{id, ok:true}`，剩余图 `sort_order` 连续 1,2）
- 6 类上传均单次直传 `portfolio-public`（各 1 上传 / 0 下载 / 0 落 private）
- 静态：index.html 无运行时 `cdn.jsdelivr.net`；vendor 已接入；`supabaseClient.js` 改用 `globalThis.supabase`
- 静态：`workEdit.renderImages` 已并行（Promise.all）
- 14 项业务回归（真实规模数据集 25 作品 / 6 证书 / 110 漫画页）：新建上传 / 已发布增图 / 替换封面 / 替换普通图 / 漫画新增替换 / 删单图不乱序 / 替换原位 / 发布A出现 / 下架A消失 / 再发布恢复 / 整删A消失 / Dashboard正常 / About证书正常 / 5漫画110页读取

> 说明：旧的 `final16_gate.mjs` / `perf_stability_gate.mjs` / `dashboard_proxy_gate.mjs` 断言的是**已废除的跨 bucket 状态机**行为，已被本 Simple AB 模型取代，**不纳入 FINAL16.3 回归**（它们若运行会 FAIL，因对应代码路径已移除）。

---

## 4. 严格指标（最终格式）

| 指标 | 值 |
|---|---|
| commit SHA | `58cd885ecc779a46d4c8f0eae283b36800f826a3` |
| publish 期间 Storage 上传次数 | 0 |
| publish 期间 Storage 下载次数 | 0 |
| unpublish Storage 传输次数 | 0 |
| delete work Storage 传输次数 | 0（1 张 / 50 张图均 0，不随图片 MB 增长） |
| 单图删除是否完整 hydrate | 否（repository 返回 `{id, ok:true}`，0 次 table select） |
| workEdit 预览是否并行 | 是（Promise.all） |
| jsDelivr runtime dependency | NO（本地 vendor 2.112.3 UMD） |
| 正式真人 publish 耗时 | 待真人实测（结构化保证：0 次 Storage 传输，仅 1 次 works 行 UPDATE + 管理员校验，理论 <2s） |
| 正式真人 unpublish 耗时 | 待真人实测（同上，<2s） |
| 正式真人 delete 耗时 | 待真人实测（单次事务：is_public=false + 3 次表 DELETE，不随图片 MB 增长，<2s） |
| 全量回归结果 | 75 PASS / 0 FAIL（tests/final16_3_simple_ab.mjs） |
| snapshot final9 SHA | `16bdea799b92c8cb8003f893f0ccd82a00a24150`（绝对冻结，未触碰） |

---

## 5. 缓存与部署

- 缓存 token：`20260828-final16.2.1` → **`20260828-final16.3-simple`**（index.html ×7、src/main.js ×1，已升级）。
- `push main` 已执行；GitHub Pages 同源更新。
- `snapshot/final9-20260826` 分支与 commit `16bdea7…` 全程冻结未改动。

---

## 6. 待持有人真人验证（不可由自动化替代）

- 用正式管理员账号在**手机网络（390 视口）**实测 publish / unpublish / delete 的真实端到端耗时，确认 <2s 硬指标。
- 实测「新上传 Network 中该文件仅 1 次真正的 Storage 上传」「发布/下架/删除 0 次 Storage 传输」与 Gate 结论一致。
- 后台 `/#/admin` 管理员密码不写入任何文件，由持有人真人登录验证。
