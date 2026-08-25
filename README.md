# QIU YUZHEN 作品集 · 交付说明

> 设计方向：邱钰真（QIU YUZHEN）· 插画 / 漫画 / 油画 个人作品集
> 技术形态：零依赖 ESM 单页应用（hash 路由 + 原生 hyperscript），已接入 Supabase 真实云端（只读 + 结构化写入 + 媒体发布生命周期）；`?mock=1` 可走 Mock 回滚预览通道。

---

## 阶段状态

### 基础工程 base-final-3（已冻结，作为底层）
基础工程已通过人工验收并冻结，包含：首页 / Works / About 三大基础版式、美拉德（Maillard）主色体系、5 部漫画连续纵向阅读、真实作品顺序与内容、首屏封面 eager/high 其余 lazy、About 时间线降序。

### Phase 2 Final — Editorial Visual Identity（已通过人工视觉验收，版式/配色冻结）
第二阶段目标：在不改已冻结版式/配色/结构/连续阅读的前提下，建立成熟、克制、有艺术出版物气质的编辑式视觉识别系统（减法 + 事实纠正）。

**视觉系统已通过人工像素级视觉验收并正式冻结**（字标 / 章节 / 展签 / 配色 / 纸张 / 漫画深咖区 / 260ms 交互 / 手机筛选 / 连续阅读不再修改）。后续轮次仅做数据层、证书方向、后台字段契约等非视觉结果修复。

---

## Phase 2 Final Gate 收口轮次（多轮，仅修非视觉项）

### Final Gate 末轮修正（2026-08-22，Phase 3 启动前的最后一次视觉/文档/隐私收口轮）
本轮 4 项，均为 Phase 3 启动前对既有视觉/文档/隐私的收口，不进入 Phase 3 功能开发：

1. **About 证书视觉第一张修正**：客户所指"页面上看到的第一张奖状横过来"是**视觉首张**，非内部 ID。
   已将正确朝向衍生图 `c01_rot.jpg`（横版）所在的横版组整体前置，使视觉第一张即为横向 c01_rot；
   其余证书保持真实比例自然排列（竖并排 / 横宽展），不旋转文字、不裁切。
   （`src/ui/pages/about.js`：landscape 行渲染于 portrait 行之前。）
2. **Git 历史隐私清理（已执行，2026-08-22）**：
   - 废弃旧 `_ghpages`(7126b5d 单 commit) + `commit --amend` + 裸 `--force` 方案（基线错误、无法清多 commit 历史、有覆盖风险）。
   - 新建独立安全目录 `_git_history_safe/`，从真实 `origin/main` fresh clone，执行前验证 `HEAD == origin/main == 69674e4b932ecb5b32753e1d4f16e7f115b40c26`。
   - 执行前确认 c07 敏感文件（原图 + 480w jpg/webp 共 3 个）存在于 HEAD 树与多历史 commit。
   - 已用 `git filter-repo --sensitive-data-removal --invert-paths`（git-filter-repo 2.47.0）全历史路径删除，重写 **1926 / 1926 commits**；推送后远程 `main = 1785fbefe1ae2cdcf6d6aa29d2c18aef0d8d9df1`（--force-with-lease）。
   - 验收（2026-08-22 执行；2026-08-24 复验）：main 分支 Pages + raw 四项 c07 访问**全部 404**；旧 SHA `69674e4…` 经 raw 亦**已不可达（404）**——GitHub Support 工单 #4689581 平台侧缓存对象已清除，隐私清理 100% 完成。
   - 详见 `_git_history_safe/_c07_cleanup_execution_report.md` 与 `GIT_HISTORY_CLEANUP_PLAN.md`；本地回滚备份 `repo_inspect_pre_cleanup_202608221914.tar.gz`。
3. **PHASE3_REQUIREMENTS.md 修正**：
   - `localStorage` 描述改为"同浏览器/同 origin 可保留，但非服务器持久化、不可跨设备/跨浏览器同步"。
   - 封面 / 非漫画多图 / `type` 分类：区分 UI 已有 Mock（存 localStorage）vs Phase 3 替换真实对象存储 / 真实持久化。
   - About 基础资料 / 教育 / 经历 / 技能 / 荣誉 / 联系方式：改为"Phase 3 新增 UI + 数据持久化"（当前正式后台无对应管理页）。
   - `workNature` 取值契约统一为 `original | fan`，禁止文档再写 `fan-work`。
   - 首页精选（`homeFeatured`）与 Works 默认页精选（`worksPicks`）拆分为两个独立后台控制维度，不再永久共用单一 `featured`。
4. **完整回归 16 截图**（Home / Works / Comics / Illustration / Oil / About / Work Detail / Comic Reader × 1440+390）：
   每页自动检查 `pending_img / overflow / 404 / console_error` 均 = 0（见 `_final_gate_round3_report.md`）。

### 本轮落实要点（11 项，视觉冻结前）
1. **作品性质字段（事实纠正）**：数据层为漫画新增 `workNature: 'original' | 'fan'`。
   CP30《舞机》= `fan`（客户明确的 Fan Work，不拥有原作 IP）；其余 4 部确认原创 = `original`。
   所有展签的"原创 / 同人"标记一律由 `natureSub(work)` 从真实字段生成
   （原创漫画 → `ORIGINAL COMIC`，同人 → `FAN WORK`），**严禁通过标题硬编码判断**。
2. **页脚中立化**：删除"所有作品均为原创"，改为中性 `© 2026 QIU YUZHEN · PORTFOLIO`。
3. **Hero 减法**：删除旧编号 `01 / 05`，Hero 仅保留极小身份文字 `Illustration & Comic`；正式章节从 `01` 起（插画专题 / 核心漫画 / 综合创作）。
4. **裸 QY 全部移除**：章节右侧的 `QY` 占位字母组合全部删除；字标仅保留完整 `QIU YUZHEN`，真正的 QY monogram 待后续单独人工确认。
5. **展签两级系统**：
   - A 级（Full Label）：首页精选、Works 前 6 件重点作品、漫画核心项目 → 细线 + 编号 + 类目 + 标题 + 真实属性 + VIEW PROJECT。
   - B 级（Compact Label）：Works 普通 Archive 作品 → 仅 标题 + 类目，无编号 / 长细线 / ORIGINAL WORK / VIEW PROJECT。
6. **漫画目录去重**：左 `01 / COMIC` + 标题 + `年份 · 性质`，右 `27P →`；删除"共 27 页"等重复表达。
7. **连续漫画页码**：桌面保留 `P. 01 / P. 02…`（约 10px、极弱灰褐、无框、不覆盖作品）；`≤720px` 隐藏，避免阅读噪音。
8. **微交互**：图片 hover 时长 `420ms → 260ms`，保持 `scale 1.01–1.015`；新增 `:focus-visible / :focus-within` 轻反馈，键盘可访问。
9. **字标减法**：本轮仅保留完整英文字标作主识别，不新增 QY 装饰。
10. **手机端**：`≤720px` 删除 VIEW PROJECT 强制显示（卡片可点击，不重复 CTA）；漫画页码隐藏。
11. **未扩展**：视觉冻结轮仅修上述项，未改其他页面。

---

## Phase 3 状态（已交付，Final Closure）

- **Phase 3-C1（只读接入，已冻结）**：Supabase 真实只读接入，前台读取 25 件作品 / 6 证书 / 110 漫画页真实数据；C1 集成测试 151/151 冻结。
- **Phase 3-C2（结构化写入，已交付）**：作品 / 证书 / About / 漫画基本信息 + 排序真实写入（受 B1 RLS + `is_admin()` 守卫）；不传/替/删媒体、不写 Storage。C2 集成测试 203/203。
- **Phase 3-C3（媒体写入 + 发布生命周期，RELEASE CANDIDATE）**：
  - Storage 双桶（portfolio-private / portfolio-public）；上传落 private，**真实 publish 流程在 canonical flip 前完成 private→public Storage 拷贝并校验 public 对象真实存在**（item 1 修复）。
  - 后台新增**草稿 / 发布 / 下架**生命周期：上传媒体不自动公开，管理员显式发布才公开；已发布可下架并重新发布；destructive physical delete 仍禁用。
  - C3 集成测试 96/96（含真实双桶 Storage 拷贝、发布/下架/重发布、非管理员拒绝、发布失败回滚等）。
- **正式环境配置**：前端仅持有 `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`；缺失配置时**失败即报错（fail-closed），绝不静默回 Mock**。`?mock=1` 仍可用作本地回滚预览通道。
- 交付与测试报告见 `FINAL_CLOSURE_REPORT.md` / `PHASE3_C3_REPORT.md`。

---

## 视觉识别设计语言（全站统一）

- 字标：`QIU YUZHEN`（Songti 字形，字距 0.22em），无图形 Logo。
- 章节系统：1px 墨线 + 编号 + EN 大写 tracking + CN 标题（home / Works / About 同源，深色版覆盖线色）。
- 展签：美术馆展签语言（细线 + 编号 + 标题 + 极小辅助文字），不使用卡片背景。
- 出版物细节：咖啡发丝线、边角编号、节页码、套准十字（每页 ≤1–2，不堆砌）。
- 美拉德体系继续：暖白 / 米杏 / 咖啡 / 焦糖 / 灰褐 / 深炭，不新增主色；识别靠字形 / 比例 / 线 / 编号 / 展签。
- 纸张质感：`body::before` SVG 噪声 opacity 0.018 + multiply，仅暖白、近不可见。

## 验收原则
若所有客户作品以灰矩形替换，站点仍呈现统一、成熟、可辨识的艺术作品集气质（80% 作品 / 20% 视觉识别）；视觉系统不喧宾夺主、不覆盖作品。

---

## 本地预览
本压缩包根目录即项目根（含 `index.html` 与 `src/`），无需再 `cd` 进入子目录。

```bash
node serve.mjs          # 默认端口见终端输出
# 打开 http://localhost:<port>/
```
- Windows：直接双击 `start.bat` 即可启动本地预览。
- macOS / Linux：在终端运行 `bash start.sh`（或 `./start.sh`）。
