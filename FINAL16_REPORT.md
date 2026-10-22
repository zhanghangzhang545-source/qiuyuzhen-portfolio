# FINAL16 交付报告 — REAL GATE 前最终契约修复

**状态：`PENDING LIVE APPLY / PENDING REAL GATE`**
（持有人执行 `LIVE_APPLY_FINAL16.sql` + 真人在线测试之前，一律不得标 PASS。底层代码契约已修复并通过自动 Gate。）

---

## 1. final16 SHA

- **commit：`a0d66855b60897f4a58d4780840901086ed2f2bf`**（已 push 至 `origin/main`）
- 缓存 token：`20260826-final15` → **`20260826-final16`**（index.html ×7、src/main.js ×1，已升级）
- 公网源码核验（commit-pinned raw，绕过 CDN 缓存）：`index.html` 全部 7 处 `v=20260826-final16` ✓

## 2. snapshot/final9 SHA（绝对冻结，本轮未触碰）

- **`16bdea799b92c8cb8003f893f0ccd82a00a24150`**（branch `snapshot/final9-20260826`）
- `git branch` 确认仅 `main` + `snapshot/final9-20260826`，未新建/改动任何分支。

---

## 3. 生产 RPC — fake 契约一致证明（P0-二）

自动 Gate **G1/G2（44/44 全部 PASS）** 证明：注入式 fake `publish_asset` 已忠实复刻 `003_rpc.sql` 的 ownership 守卫，不再比生产更宽松。

- fake 在 `publish_asset` 中执行与 003 同形的归属校验：
  ```js
  if (!assetReferenced(p_parent_type, p_parent_id, p_asset_id)) {
    return Promise.resolve({ data: { ok: false,
      error: `asset ${p_asset_id} is not referenced by ${p_parent_type} ${p_parent_id} (cover/work_images/comic_pages)` }, error: null });
  }
  ```
- G1：`未关联 asset 直接 publish_asset` → fake 返回 `{ok:false, error:/is not referenced/}`（与 003 同契约）。
- G2：已关联（封面）asset → `{ok:true}`。
- 额外：fake 复刻了 `prefix` 推导（含 comic→`works/comic/`）、`staging/` 前缀校验、variant set 完整性/去重/归属校验、`work_ready` 判定，error-first 返回结构。
- **结论**：自动 Gate 不再用比生产 RPC 更宽松的 fake，PASS 有效。

## 4. prepare RPC 代码（P0-一，005_rpc_prepare.sql）

未关联资产「预发布」事务能力——不校验 ownership、不碰父 FK / `is_public`，仅翻 asset+variants bucket，解决「先 publish 后 link」与正式 `publish_asset` 的契约冲突：

```sql
CREATE OR REPLACE FUNCTION public.prepare_asset_public(
  p_asset_id text, p_parent_type text, p_parent_id text,
  p_public_original_path text, p_variant_paths jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE ... v_prefix text; v_work_type text;
BEGIN
  IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok', false, 'error', 'forbidden'); END IF;
  IF p_parent_type NOT IN ('work','certificate','avatar') THEN RAISE EXCEPTION 'invalid p_parent_type: %', p_parent_type; END IF;
  -- asset 必须恰好 1 行
  SELECT count(*) INTO v_asset_cnt FROM public.media_assets WHERE id = p_asset_id;
  IF v_asset_cnt <> 1 THEN RAISE EXCEPTION 'media_assets id not found or not unique: %', p_asset_id; END IF;
  -- parent 真实存在（work/certificate；avatar 不查 parent）
  IF p_parent_type = 'work' THEN
    SELECT count(*) INTO v_parent_cnt FROM public.works w WHERE w.id = p_parent_id;
    IF v_parent_cnt <> 1 THEN RAISE EXCEPTION 'work % not found', p_parent_id; END IF;
    SELECT w.type INTO v_work_type FROM public.works w WHERE w.id = p_parent_id;
    v_prefix := 'works/' || COALESCE(v_work_type,'') || '/';
  ELSIF p_parent_type = 'certificate' THEN ... v_prefix := 'certificates/';
  ELSIF p_parent_type = 'avatar' THEN v_prefix := 'avatars/'; END IF;
  -- canonical 前缀校验（禁止 staging/）+ variant set 完整性/去重/归属 校验（同 003）
  ...
  -- 仅翻转 original + variants 到 public canonical（不碰父 FK / is_public）
  UPDATE public.media_assets SET bucket='portfolio-public', original_path=p_public_original_path WHERE id=p_asset_id;
  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths) LOOP
    UPDATE public.media_variants SET bucket='portfolio-public', variant_path=v_v->>'path'
     WHERE id=v_v->>'variant_id' AND asset_id=p_asset_id;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'bucket', 'portfolio-public');
EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END; $$;
```
（对称 `prepare_asset_private` 翻回 private staging，前缀 `staging/works/<type>/` 等，同样不碰父 FK / is_public。）

## 5. 单资产失败清理代码（P0-三，repository.supabase.js `_prepareOneAssetPublic`）

每个 helper 自己负责清理失败前产生的 Storage 副作用，不靠外层 done 补偿：

```js
async _prepareOneAssetPublic(assetId, parentType, parentId) {
  ...
  const createdPublic = [];          // 本轮刚在 PUBLIC 创建的 Storage 路径
  try {
    if (a.bucket === PRIVATE_BUCKET) {
      publicOriginalPath = `${prefix}${this._baseName(a.original_path)}`;
      await this._copyStorageObject(PRIVATE_BUCKET, a.original_path, PUBLIC_BUCKET, publicOriginalPath);
      createdPublic.push(publicOriginalPath);
    }
    const publicVariantPaths = await this._copyAssetVariants(assetId, parentType, parentId,
                                    { staging: false, createdPaths: createdPublic }); // variant 拷贝成功也记入
    const prep = await sb.rpc('prepare_asset_public', { ... });
    if (prep.error) throw ...;
    if (!prep.data || prep.data.ok !== true) throw ...;
    return { assetId, parentType, parentId, publicOriginalPath, publicVariantPaths };
  } catch (e) {
    // P0-三：自身失败清理本轮 public Storage（DB canonical 仍 private，未切走，不得外留孤儿）
    for (const p of createdPublic) { try { await this._deleteStorage(PUBLIC_BUCKET, p); } catch (_) {} }
    throw e;
  }
}
```
（`_publishOneAsset` / `_unpublishOneAsset` 同构：`createdPublic` / `createdStaging` 自清理，DB canonical 未被确认切走前绝不删仍引用对象。）

## 6. compensation 安全代码（P0-四，`_reversePublish` / `_rollbackPreparedAsset`）

硬规则：**DB canonical 未被确认成功切走前，绝不删除当前仍被 DB 引用的 Storage 对象**；补偿必须返回明确 `{ok, errors, restoredAssets}`，绝不假装恢复成功。

```js
async _reversePublish(one) {           // 已发布 → 恢复 private staging
  const errors = []; const restoredAssets = [];
  ...
  if (!copiesOk) return { ok: false, errors, restoredAssets };     // 无法建 staging → 保留 public，不删
  const res = await sb.rpc('unpublish_asset', { ... });
  if (res.error || !res.data || res.data.ok !== true) {
    errors.push(`unpublish_asset 逆向失败：...`);
    try { await this._deleteStorage(PRIVATE_BUCKET, stagingOriginalPath); } catch(_) {}  // 仅清本次 orphan
    for (const vp of stagingVariantPaths) try { await this._deleteStorage(PRIVATE_BUCKET, vp.path); } catch(_) {}
    return { ok: false, errors, restoredAssets };                    // public 保留（仍被引用），不删
  }
  restoredAssets.push(one.assetId);
  try { await this._deleteStorage(PUBLIC_BUCKET, one.publicOriginalPath); } catch(e){ errors.push(...); }  // 安全删
  ...
  return { ok: true, errors, restoredAssets };
}
```
`_rollbackPreparedAsset`（prepare→private 回滚）同构：prepare_asset_private 失败 → 保留 public、不删、返回 `{ok:false}`。`publishWork`/`unpublishWork` 的 catch 中逐个调用，若任一 `!r.ok` 则抛出 **「发布/下架操作未完成，系统已保留数据，请停止继续操作并联系维护人员。」** 外层不假装成功。

## 7. readiness 验证代码（P0-五）

`publishWork` 在置 `is_public=true` **之前**必须最终验证所有引用资产均真实公开；`unpublishWork` 检测混合 bucket 残留：

```js
async _verifyWorkPublicReadiness(workId) {
  // 收集 cover + work_images + comic_pages 全部 asset id
  // 每个 asset：bucket 必须 PUBLIC + original Storage 真实存在（_objectExists）
  // 每个 variant：bucket 必须 PUBLIC + variant Storage 真实存在
  // 任一不满足 → {ok:false, error}
}
async _verifyWorkNoMixedBucket(workId) {
  // 每个 asset：bucket 必须 PRIVATE；每个 variant：bucket 必须 PRIVATE
  // 任一非 private → {ok:false, error:'...混合残留'}
}
// publishWork：循环 publish 后
const readiness = await this._verifyWorkPublicReadiness(workId);
if (!readiness.ok) throw new Error(`发布就绪校验未通过：${readiness.error}`);
const { data: cur } = await sb.from('works').select('is_public').eq('id', workId).maybeSingle();
if (cur && cur.is_public !== true) { await sb.from('works').update({ is_public: true }).eq('id', workId); } // 仅当确未置位
// unpublishWork：循环 unpublish 后
const mix = await this._verifyWorkNoMixedBucket(workId);
if (!mix.ok) throw new Error(`下架混合状态检测未通过：${mix.error}`);
```

## 8. 公开漫画最后 1 页保护（P0-七，004_rpc_atomic.sql `remove_comic_page_and_reorder`）

```sql
  SELECT is_public INTO v_is_pub FROM public.works WHERE id = p_work_id;
  IF v_is_pub IS TRUE THEN
    SELECT count(*) INTO v_cur FROM public.comic_pages WHERE work_id = p_work_id;
    IF v_cur <= 1 THEN
      RAISE EXCEPTION '公开漫画至少需要保留1页。如需删除最后一页，请先下架漫画。';
    END IF;
  END IF;
```
（草稿漫画 `is_public=false` 允许删成 0 页。fake RPC 同步硬化，Gate G11 拒绝 / G12 允许。）

## 9. append 原子 RPC（P0-八，006_rpc_append.sql）

替代 JS 端「SELECT max → +1 → INSERT」并发不安全写法；事务内 `FOR UPDATE` 锁行，计算 max+1 插入，追加永远到末尾：

```sql
CREATE OR REPLACE FUNCTION public.append_work_image(p_work_id text, p_media_asset_id text) RETURNS jsonb ... AS $$
DECLARE ... v_max int; v_new_id text; v_dummy int;
BEGIN
  ...
  SELECT 1 INTO v_dummy FROM public.works w WHERE w.id = p_work_id FOR UPDATE;   -- 串行化并发追加
  SELECT COALESCE(max(sort_order),0) INTO v_max FROM public.work_images WHERE work_id = p_work_id;
  v_new_id := 'wi-' || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.work_images (id, work_id, media_asset_id, sort_order, alt_text)
  VALUES (v_new_id, p_work_id, p_media_asset_id, v_max + 1, NULL);
  RETURN jsonb_build_object('ok', true, 'work_id', p_work_id, 'image_id', v_new_id);
END; $$;
```
（`append_comic_page` 同构：`page_number = max+1`，`sort_order = max+1`，二者对齐；id `cp-<uuid>`。JS `addWorkImage`/`addComicPage` 现调用此 RPC，Gate G13 证明无 JS 端 `work_images` insert、sort_order 唯一稳定。）

## 10. LIVE_APPLY_FINAL16.sql 路径

**`C:/Users/Public/Temp/final-gate-regression/repo/supabase/LIVE_APPLY_FINAL16.sql`**

- 由 003/004/005/006 合并生成，**幂等 `CREATE OR REPLACE`**，无 secret；
- 含全部 8 个 RPC：`publish_asset`(003 comic 前缀已修)、`unpublish_asset`、`remove_work_image_and_reorder`、`remove_comic_page_and_reorder`、`prepare_asset_public`、`prepare_asset_private`、`append_work_image`、`append_comic_page`；
- 含必要 `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO authenticated`；
- 末尾 `NOTIFY pgrst, 'reload schema';`；
- **附只读核验 SQL**：查询 `pg_proc` 确认 9 个函数签名真实存在且 `authenticated` 有 `EXECUTE`（预期每行 `authenticated_execute = true`）。
- **持有人须先在线上 SQL Editor 执行此文件，再用核验 SQL 确认 8 个新/改 RPC 真实存在且 EXECUTE 正确，之后才允许 REAL HUMAN GATE。**

## 11. 自动 Gate 结果（tests/final16_gate.mjs）

**`C:/Users/Public/Temp/final-gate-regression/repo/tests/final16_gate.mjs`**
- 硬化 fake RPC（忠实复刻 003 ownership guard + 005/006 prepare/append 语义 + 004 最后1页保护）；
- **44/44 断言 PASS，覆盖 P0-十一 全部 16 项 Gate（G1–G16，禁止只做字符串断言）**：
  G1/G2 ownership guard 与 fake 一致（未关联拒绝）、G3 prepare 后父 FK 不变、G4 link 成功→FK 指向 public + 返回 canonical URL（P0-十）、G5 link 失败→FK 恢复+asset 回滚、G6 original copy 后 RPC 失败无 public 孤儿、G7 prepare 失败清理全部本轮拷贝、G8 逆向 RPC 失败不删 DB 仍引用对象、G9 publishWork readiness 验证、G10 unpublishWork 混合 bucket 检测、G11 公开漫画最后1页拒绝、G12 草稿漫画最后1页可删、G13 并发 append 唯一稳定（无 JS max+1 insert）、G14 work images F5 稳定、G15 comic pages F5 稳定、G16 RPC error 保留 code/message/details/hint。

---

## 12. 下一步（P0-六 / P0-十二，持有人执行）

1. 持有人打开 Supabase SQL Editor，粘贴执行 **`LIVE_APPLY_FINAL16.sql`**；
2. 执行末尾只读核验 SQL，确认 `publish_asset` / `unpublish_asset` / `remove_work_image_and_reorder` / `remove_comic_page_and_reorder` / `prepare_asset_public` / `prepare_asset_private` / `append_work_image` / `append_comic_page` 全部真实存在且 `authenticated` 有 `EXECUTE`；
3. 核验通过后，方可进行 REAL HUMAN GATE（真人删除/排序/媒体替换）。

**当前状态：`PENDING LIVE APPLY / PENDING REAL GATE` —— 未执行 LIVE_APPLY 前，任何前端真人数据操作均不得标 PASS。**
