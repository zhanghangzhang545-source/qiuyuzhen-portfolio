-- ============================================================
-- FINAL16: 线上 SQL 应用脚本 (LIVE_APPLY_FINAL16.sql)
-- ------------------------------------------------------------
-- 由 003/004/005/006 migration 合并生成（幂等 CREATE OR REPLACE）。
-- 持有人在 Supabase SQL Editor 全量粘贴执行一次即可。
-- 无 secret；所有函数 SECURITY DEFINER + is_admin() 守卫；
-- EXECUTE 仅授权 authenticated（仍经 is_admin 守卫）。
-- 应用后请执行末尾【只读核验 SQL】确认 9 个函数签名真实存在且 authenticated 有 EXECUTE。
-- ============================================================

-- ---- RPC 函数定义（幂等）----

-- --- 函数 1 ---
CREATE OR REPLACE FUNCTION public.publish_asset(
  p_asset_id        text,
  p_parent_type     text,                 -- 'work' | 'certificate' | 'avatar'
  p_parent_id       text,                 -- works.id / certificates.id / 忽略(avatar 用 asset_id)
  p_public_original_path text,            -- 该资产 original 的 public canonical path（前缀须合法）
  p_variant_paths   jsonb                 -- [{variant_id, path}, ...] 每个 variant 的 public canonical path（前缀须合法）
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result      jsonb;
  v_v           jsonb;
  v_asset_cnt   int;
  v_db_var_cnt  int;
  v_in_var_cnt  int;
  v_distinct_cnt int;
  v_match_cnt   int;
  v_aff         int;
  v_link_cnt    int;   -- asset→parent 真实归属计数
  v_pub_cnt     int;   -- work 全量媒体 canonical 状态计数
  v_req_cnt     int;   -- work 必需媒体引用计数
  v_prefix      text;  -- 合法 public 前缀（按 parent_type / work 真实引用类型）
  v_is_comic    int;   -- work 资产是否被 comic_pages 引用（漫画正文页）
  v_work_type   text;  -- work 真实 type（用于封面/多图合法前缀）
BEGIN
  -- 权限守卫
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- parent_type 白名单
  IF p_parent_type NOT IN ('work', 'certificate', 'avatar') THEN
    RAISE EXCEPTION 'invalid p_parent_type: %', p_parent_type;
  END IF;

  -- asset 必须恰好存在 1 行
  SELECT count(*) INTO v_asset_cnt FROM public.media_assets WHERE id = p_asset_id;
  IF v_asset_cnt <> 1 THEN
    RAISE EXCEPTION 'media_assets id not found or not unique: % (count=%)', p_asset_id, v_asset_cnt;
  END IF;

  -- asset→parent 真实归属验证：asset 必须被该 parent 真实引用，否则错配阻断
  IF p_parent_type = 'work' THEN
    SELECT count(*) INTO v_link_cnt FROM public.works w
     WHERE w.id = p_parent_id
       AND (w.cover_asset_id = p_asset_id
            OR EXISTS (SELECT 1 FROM public.work_images wi WHERE wi.work_id = w.id AND wi.media_asset_id = p_asset_id)
            OR EXISTS (SELECT 1 FROM public.comic_pages cp WHERE cp.work_id = w.id AND cp.media_asset_id = p_asset_id));
    IF v_link_cnt < 1 THEN
      RAISE EXCEPTION 'asset % is not referenced by work % (cover/work_images/comic_pages)', p_asset_id, p_parent_id;
    END IF;
    -- 按真实引用关系决定合法 public 前缀（冻结规范 Final-3.2a）：
    SELECT count(*) INTO v_is_comic
      FROM public.comic_pages cp WHERE cp.work_id = p_parent_id AND cp.media_asset_id = p_asset_id;
    SELECT w.type INTO v_work_type FROM public.works w WHERE w.id = p_parent_id;
    IF v_is_comic > 0 THEN
      v_prefix := 'works/comic/';
    ELSE
      v_prefix := 'works/' || COALESCE(v_work_type, '') || '/';
    END IF;
  ELSIF p_parent_type = 'certificate' THEN
    SELECT count(*) INTO v_link_cnt FROM public.certificates c
     WHERE c.id = p_parent_id AND c.media_asset_id = p_asset_id;
    IF v_link_cnt < 1 THEN
      RAISE EXCEPTION 'asset % is not referenced by certificate % (media_asset_id mismatch)', p_asset_id, p_parent_id;
    END IF;
    v_prefix := 'certificates/';
  ELSIF p_parent_type = 'avatar' THEN
    SELECT count(*) INTO v_link_cnt FROM public.profile p
     WHERE p.avatar_asset_id = p_asset_id;
    IF v_link_cnt < 1 THEN
      RAISE EXCEPTION 'asset % is not referenced by profile.avatar_asset_id', p_asset_id;
    END IF;
    v_prefix := 'avatars/';
  END IF;

  -- canonical path 前缀校验（publish：必须合法 public 前缀，且禁止 staging/）
  IF p_public_original_path IS NULL OR p_public_original_path = '' THEN
    RAISE EXCEPTION 'p_public_original_path is null/empty';
  END IF;
  IF p_public_original_path LIKE 'staging/%' THEN
    RAISE EXCEPTION 'public original path must not start with staging/: %', p_public_original_path;
  END IF;
  IF p_public_original_path NOT LIKE (v_prefix || '%') THEN
    RAISE EXCEPTION 'public original path must start with %: %', v_prefix, p_public_original_path;
  END IF;

  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths)
  LOOP
    IF v_v->>'path' IS NULL OR v_v->>'path' = '' THEN
      RAISE EXCEPTION 'variant path is null/empty for %', v_v->>'variant_id';
    END IF;
    IF v_v->>'path' LIKE 'staging/%' THEN
      RAISE EXCEPTION 'public variant path must not start with staging/: %', v_v->>'path';
    END IF;
    IF v_v->>'path' NOT LIKE (v_prefix || '%') THEN
      RAISE EXCEPTION 'public variant path must start with %: %', v_prefix, v_v->>'path';
    END IF;
  END LOOP;

  -- variant_paths 输入完整性校验
  SELECT count(*) INTO v_in_var_cnt
    FROM jsonb_array_elements(p_variant_paths);
  SELECT count(DISTINCT t.v_col->>'variant_id') INTO v_distinct_cnt
    FROM jsonb_array_elements(p_variant_paths) AS t(v_col);
  IF v_in_var_cnt <> v_distinct_cnt THEN
    RAISE EXCEPTION 'duplicate variant_id in p_variant_paths';
  END IF;

  -- 数据库中该 asset 实际 variant 集合
  SELECT count(*) INTO v_db_var_cnt FROM public.media_variants WHERE asset_id = p_asset_id;
  IF v_in_var_cnt <> v_db_var_cnt THEN
    RAISE EXCEPTION 'variant set size mismatch: input=% db=%', v_in_var_cnt, v_db_var_cnt;
  END IF;

  -- 每个传入 variant_id 必须属于该 asset（且恰好 1 行）
  SELECT count(*) INTO v_match_cnt
    FROM jsonb_array_elements(p_variant_paths) AS t(v_col)
    WHERE EXISTS (
      SELECT 1 FROM public.media_variants mv
       WHERE mv.id = t.v_col->>'variant_id' AND mv.asset_id = p_asset_id
    );
  IF v_match_cnt <> v_in_var_cnt THEN
    RAISE EXCEPTION 'some variant_id does not belong to asset %', p_asset_id;
  END IF;

  -- 翻转 original（bucket + 目标 canonical path 同事务提交），校验 affected=1
  UPDATE public.media_assets
     SET bucket = 'portfolio-public',
         original_path = p_public_original_path
   WHERE id = p_asset_id;
  GET DIAGNOSTICS v_aff = ROW_COUNT;
  IF v_aff <> 1 THEN
    RAISE EXCEPTION 'media_assets update affected % rows (expected 1)', v_aff;
  END IF;

  -- 翻转子项 variants（全部同事务切换 bucket + variant_path），逐条校验 affected=1
  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths)
  LOOP
    UPDATE public.media_variants
       SET bucket = 'portfolio-public',
           variant_path = v_v->>'path'
     WHERE id = v_v->>'variant_id'
       AND asset_id = p_asset_id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'media_variants update affected % rows for % (expected 1)', v_aff, v_v->>'variant_id';
    END IF;
  END LOOP;

  -- 父记录公开标记处理（本 asset 已成功发布）
  IF p_parent_type = 'work' THEN
    SELECT count(*) INTO v_req_cnt FROM (
      SELECT public.works.cover_asset_id AS aid FROM public.works WHERE public.works.id = p_parent_id
      UNION
      SELECT wi.media_asset_id FROM public.work_images wi WHERE wi.work_id = p_parent_id
      UNION
      SELECT cp.media_asset_id FROM public.comic_pages cp WHERE cp.work_id = p_parent_id
    ) AS req WHERE aid IS NOT NULL;

    SELECT count(*) INTO v_pub_cnt FROM (
      SELECT public.works.cover_asset_id AS aid FROM public.works WHERE public.works.id = p_parent_id
      UNION
      SELECT wi.media_asset_id FROM public.work_images wi WHERE wi.work_id = p_parent_id
      UNION
      SELECT cp.media_asset_id FROM public.comic_pages cp WHERE cp.work_id = p_parent_id
    ) AS req
    WHERE aid IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.media_assets ma WHERE ma.id = req.aid AND ma.bucket = 'portfolio-public')
      AND NOT EXISTS (
        SELECT 1 FROM public.media_variants mv
         WHERE mv.asset_id = req.aid AND mv.bucket <> 'portfolio-public'
      );

    IF v_req_cnt = v_pub_cnt THEN
      UPDATE public.works SET is_public = true WHERE id = p_parent_id;
      GET DIAGNOSTICS v_aff = ROW_COUNT;
      IF v_aff <> 1 THEN
        RAISE EXCEPTION 'works update affected % rows (expected 1)', v_aff;
      END IF;
      v_result := jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'bucket', 'portfolio-public', 'work_ready', true);
    ELSE
      UPDATE public.works SET is_public = false WHERE id = p_parent_id;
      GET DIAGNOSTICS v_aff = ROW_COUNT;
      IF v_aff <> 1 THEN
        RAISE EXCEPTION 'works update affected % rows (expected 1)', v_aff;
      END IF;
      v_result := jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'bucket', 'portfolio-public', 'work_ready', false);
    END IF;
  ELSIF p_parent_type = 'certificate' THEN
    UPDATE public.certificates SET is_public = true WHERE id = p_parent_id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'certificates update affected % rows (expected 1)', v_aff;
    END IF;
    v_result := jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'bucket', 'portfolio-public');
  ELSIF p_parent_type = 'avatar' THEN
    v_result := jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'bucket', 'portfolio-public');
  END IF;

  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


-- --- 函数 2 ---
CREATE OR REPLACE FUNCTION public.unpublish_asset(
  p_asset_id        text,
  p_parent_type     text,
  p_parent_id       text,
  p_private_original_path text,
  p_variant_paths   jsonb                 -- [{variant_id, path}, ...] 每个 variant 的 private canonical path（前缀须合法 staging/）
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result      jsonb;
  v_v           jsonb;
  v_asset_cnt   int;
  v_db_var_cnt  int;
  v_in_var_cnt  int;
  v_distinct_cnt int;
  v_match_cnt   int;
  v_aff         int;
  v_link_cnt    int;   -- asset→parent 真实归属计数
  v_stage_prefix text; -- 合法 private/staging 前缀（按 parent_type / work 真实引用类型）
  v_is_comic    int;   -- work 资产是否被 comic_pages 引用（漫画正文页）
  v_work_type   text;  -- work 真实 type（用于封面/多图合法前缀）
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_parent_type NOT IN ('work', 'certificate', 'avatar') THEN
    RAISE EXCEPTION 'invalid p_parent_type: %', p_parent_type;
  END IF;

  SELECT count(*) INTO v_asset_cnt FROM public.media_assets WHERE id = p_asset_id;
  IF v_asset_cnt <> 1 THEN
    RAISE EXCEPTION 'media_assets id not found or not unique: % (count=%)', p_asset_id, v_asset_cnt;
  END IF;

  -- asset→parent 真实归属验证（与 publish 同构）：错配阻断，避免错挂资产被取消公开
  IF p_parent_type = 'work' THEN
    SELECT count(*) INTO v_link_cnt FROM public.works w
     WHERE w.id = p_parent_id
       AND (w.cover_asset_id = p_asset_id
            OR EXISTS (SELECT 1 FROM public.work_images wi WHERE wi.work_id = w.id AND wi.media_asset_id = p_asset_id)
            OR EXISTS (SELECT 1 FROM public.comic_pages cp WHERE cp.work_id = w.id AND cp.media_asset_id = p_asset_id));
    IF v_link_cnt < 1 THEN
      RAISE EXCEPTION 'asset % is not referenced by work % (cover/work_images/comic_pages)', p_asset_id, p_parent_id;
    END IF;
    SELECT count(*) INTO v_is_comic
      FROM public.comic_pages cp WHERE cp.work_id = p_parent_id AND cp.media_asset_id = p_asset_id;
    SELECT w.type INTO v_work_type FROM public.works w WHERE w.id = p_parent_id;
    IF v_is_comic > 0 THEN
      v_stage_prefix := 'staging/works/comic/';
    ELSE
      v_stage_prefix := 'staging/works/' || COALESCE(v_work_type, '') || '/';
    END IF;
  ELSIF p_parent_type = 'certificate' THEN
    SELECT count(*) INTO v_link_cnt FROM public.certificates c
     WHERE c.id = p_parent_id AND c.media_asset_id = p_asset_id;
    IF v_link_cnt < 1 THEN
      RAISE EXCEPTION 'asset % is not referenced by certificate % (media_asset_id mismatch)', p_asset_id, p_parent_id;
    END IF;
    v_stage_prefix := 'staging/certificates/';
  ELSIF p_parent_type = 'avatar' THEN
    SELECT count(*) INTO v_link_cnt FROM public.profile p
     WHERE p.avatar_asset_id = p_asset_id;
    IF v_link_cnt < 1 THEN
      RAISE EXCEPTION 'asset % is not referenced by profile.avatar_asset_id', p_asset_id;
    END IF;
    v_stage_prefix := 'staging/avatars/';
  END IF;

  -- canonical path 前缀校验（unpublish：必须合法 private/staging 前缀，且禁止以 public 前缀误传）
  IF p_private_original_path IS NULL OR p_private_original_path = '' THEN
    RAISE EXCEPTION 'p_private_original_path is null/empty';
  END IF;
  IF p_private_original_path NOT LIKE (v_stage_prefix || '%') THEN
    RAISE EXCEPTION 'private original path must start with %: %', v_stage_prefix, p_private_original_path;
  END IF;

  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths)
  LOOP
    IF v_v->>'path' IS NULL OR v_v->>'path' = '' THEN
      RAISE EXCEPTION 'variant path is null/empty for %', v_v->>'variant_id';
    END IF;
    IF v_v->>'path' NOT LIKE (v_stage_prefix || '%') THEN
      RAISE EXCEPTION 'private variant path must start with %: %', v_stage_prefix, v_v->>'path';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_in_var_cnt FROM jsonb_array_elements(p_variant_paths);
  SELECT count(DISTINCT t.v_col->>'variant_id') INTO v_distinct_cnt
    FROM jsonb_array_elements(p_variant_paths) AS t(v_col);
  IF v_in_var_cnt <> v_distinct_cnt THEN
    RAISE EXCEPTION 'duplicate variant_id in p_variant_paths';
  END IF;

  SELECT count(*) INTO v_db_var_cnt FROM public.media_variants WHERE asset_id = p_asset_id;
  IF v_in_var_cnt <> v_db_var_cnt THEN
    RAISE EXCEPTION 'variant set size mismatch: input=% db=%', v_in_var_cnt, v_db_var_cnt;
  END IF;

  SELECT count(*) INTO v_match_cnt
    FROM jsonb_array_elements(p_variant_paths) AS t(v_col)
    WHERE EXISTS (
      SELECT 1 FROM public.media_variants mv
       WHERE mv.id = t.v_col->>'variant_id' AND mv.asset_id = p_asset_id
    );
  IF v_match_cnt <> v_in_var_cnt THEN
    RAISE EXCEPTION 'some variant_id does not belong to asset %', p_asset_id;
  END IF;

  UPDATE public.media_assets
     SET bucket = 'portfolio-private',
         original_path = p_private_original_path
   WHERE id = p_asset_id;
  GET DIAGNOSTICS v_aff = ROW_COUNT;
  IF v_aff <> 1 THEN
    RAISE EXCEPTION 'media_assets update affected % rows (expected 1)', v_aff;
  END IF;

  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths)
  LOOP
    UPDATE public.media_variants
       SET bucket = 'portfolio-private',
           variant_path = v_v->>'path'
     WHERE id = v_v->>'variant_id'
       AND asset_id = p_asset_id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'media_variants update affected % rows for % (expected 1)', v_aff, v_v->>'variant_id';
    END IF;
  END LOOP;

  IF p_parent_type = 'work' THEN
    UPDATE public.works SET is_public = false WHERE id = p_parent_id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'works update affected % rows (expected 1)', v_aff;
    END IF;
  ELSIF p_parent_type = 'certificate' THEN
    UPDATE public.certificates SET is_public = false WHERE id = p_parent_id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'certificates update affected % rows (expected 1)', v_aff;
    END IF;
  ELSIF p_parent_type = 'avatar' THEN
    NULL;
  END IF;

  v_result := jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'bucket', 'portfolio-private');
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


-- --- 函数 3 ---
CREATE OR REPLACE FUNCTION public.remove_work_image_and_reorder(
  p_work_id  text,
  p_image_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cnt   int;
  v_aff   int;
  v_row   record;
  v_idx   int := 0;
  v_is_pub boolean;
  v_cur    int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  -- 目标必须恰好属于该作品 1 行
  SELECT count(*) INTO v_cnt
    FROM public.work_images WHERE id = p_image_id AND work_id = p_work_id;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'work_image % not found for work % (count=%)', p_image_id, p_work_id, v_cnt;
  END IF;

  -- 删除目标关联行
  DELETE FROM public.work_images WHERE id = p_image_id AND work_id = p_work_id;
  GET DIAGNOSTICS v_aff = ROW_COUNT;
  IF v_aff <> 1 THEN
    RAISE EXCEPTION 'work_images delete affected % rows (expected 1)', v_aff;
  END IF;

  -- 按删除前相对顺序（sort_order ASC，id ASC 兜底）连续规范化 sort_order（1..N），
  -- media_asset_id / alt_text 保持不变。
  FOR v_row IN
    SELECT id, media_asset_id, alt_text
      FROM public.work_images
     WHERE work_id = p_work_id
     ORDER BY sort_order ASC, id ASC
  LOOP
    v_idx := v_idx + 1;
    UPDATE public.work_images
       SET sort_order = v_idx
     WHERE id = v_row.id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'work_images reorder affected % rows for % (expected 1)', v_aff, v_row.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'work_id', p_work_id, 'removed_image_id', p_image_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


-- --- 函数 4 ---
CREATE OR REPLACE FUNCTION public.remove_comic_page_and_reorder(
  p_work_id text,
  p_page_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cnt   int;
  v_aff   int;
  v_row   record;
  v_idx   int := 0;
  v_is_pub boolean;
  v_cur    int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.comic_pages WHERE id = p_page_id AND work_id = p_work_id;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'comic_page % not found for work % (count=%)', p_page_id, p_work_id, v_cnt;
  END IF;

  -- P0-七：公开漫画最后 1 页保护。已公开（is_public=true）且当前仅剩 1 页时禁止删除，
  --   避免留下「is_public=true + comic_pages=0」的断图/空专题状态。草稿漫画（is_public=false）允许删成 0 页。
  SELECT is_public INTO v_is_pub FROM public.works WHERE id = p_work_id;
  IF v_is_pub IS TRUE THEN
    SELECT count(*) INTO v_cur FROM public.comic_pages WHERE work_id = p_work_id;
    IF v_cur <= 1 THEN
      RAISE EXCEPTION '公开漫画至少需要保留1页。如需删除最后一页，请先下架漫画。';
    END IF;
  END IF;

  DELETE FROM public.comic_pages WHERE id = p_page_id AND work_id = p_work_id;
  GET DIAGNOSTICS v_aff = ROW_COUNT;
  IF v_aff <> 1 THEN
    RAISE EXCEPTION 'comic_pages delete affected % rows (expected 1)', v_aff;
  END IF;

  -- 连续规范化 sort_order（1..N）；page_number / media_asset_id 保持不变。
  FOR v_row IN
    SELECT id, media_asset_id, page_number
      FROM public.comic_pages
     WHERE work_id = p_work_id
     ORDER BY sort_order ASC, id ASC
  LOOP
    v_idx := v_idx + 1;
    UPDATE public.comic_pages
       SET sort_order = v_idx
     WHERE id = v_row.id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'comic_pages reorder affected % rows for % (expected 1)', v_aff, v_row.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'work_id', p_work_id, 'removed_page_id', p_page_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


-- --- 函数 5 ---
CREATE OR REPLACE FUNCTION public.prepare_asset_public(
  p_asset_id             text,
  p_parent_type          text,                 -- 'work' | 'certificate' | 'avatar'
  p_parent_id            text,
  p_public_original_path text,
  p_variant_paths        jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result      jsonb;
  v_v           jsonb;
  v_asset_cnt   int;
  v_parent_cnt  int;
  v_db_var_cnt  int;
  v_in_var_cnt  int;
  v_distinct_cnt int;
  v_match_cnt   int;
  v_aff         int;
  v_prefix      text;
  v_work_type   text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_parent_type NOT IN ('work', 'certificate', 'avatar') THEN
    RAISE EXCEPTION 'invalid p_parent_type: %', p_parent_type;
  END IF;

  SELECT count(*) INTO v_asset_cnt FROM public.media_assets WHERE id = p_asset_id;
  IF v_asset_cnt <> 1 THEN
    RAISE EXCEPTION 'media_assets id not found or not unique: % (count=%)', p_asset_id, v_asset_cnt;
  END IF;

  -- parent 真实存在 + 推导合法 public 前缀（与 publish_asset 同构，但 avatar 仅校验 asset 自身）
  IF p_parent_type = 'work' THEN
    SELECT count(*) INTO v_parent_cnt FROM public.works w WHERE w.id = p_parent_id;
    IF v_parent_cnt <> 1 THEN
      RAISE EXCEPTION 'work % not found', p_parent_id;
    END IF;
    SELECT w.type INTO v_work_type FROM public.works w WHERE w.id = p_parent_id;
    v_prefix := 'works/' || COALESCE(v_work_type, '') || '/';
  ELSIF p_parent_type = 'certificate' THEN
    SELECT count(*) INTO v_parent_cnt FROM public.certificates c WHERE c.id = p_parent_id;
    IF v_parent_cnt <> 1 THEN
      RAISE EXCEPTION 'certificate % not found', p_parent_id;
    END IF;
    v_prefix := 'certificates/';
  ELSIF p_parent_type = 'avatar' THEN
    v_prefix := 'avatars/';
  END IF;

  -- canonical 前缀校验（禁止 staging/）
  IF p_public_original_path IS NULL OR p_public_original_path = '' THEN
    RAISE EXCEPTION 'p_public_original_path is null/empty';
  END IF;
  IF p_public_original_path LIKE 'staging/%' THEN
    RAISE EXCEPTION 'public original path must not start with staging/: %', p_public_original_path;
  END IF;
  IF p_public_original_path NOT LIKE (v_prefix || '%') THEN
    RAISE EXCEPTION 'public original path must start with %: %', v_prefix, p_public_original_path;
  END IF;

  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths)
  LOOP
    IF v_v->>'path' IS NULL OR v_v->>'path' = '' THEN
      RAISE EXCEPTION 'variant path is null/empty for %', v_v->>'variant_id';
    END IF;
    IF v_v->>'path' LIKE 'staging/%' THEN
      RAISE EXCEPTION 'public variant path must not start with staging/: %', v_v->>'path';
    END IF;
    IF v_v->>'path' NOT LIKE (v_prefix || '%') THEN
      RAISE EXCEPTION 'public variant path must start with %: %', v_prefix, v_v->>'path';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_in_var_cnt FROM jsonb_array_elements(p_variant_paths);
  SELECT count(DISTINCT t.v_col->>'variant_id') INTO v_distinct_cnt
    FROM jsonb_array_elements(p_variant_paths) AS t(v_col);
  IF v_in_var_cnt <> v_distinct_cnt THEN
    RAISE EXCEPTION 'duplicate variant_id in p_variant_paths';
  END IF;

  SELECT count(*) INTO v_db_var_cnt FROM public.media_variants WHERE asset_id = p_asset_id;
  IF v_in_var_cnt <> v_db_var_cnt THEN
    RAISE EXCEPTION 'variant set size mismatch: input=% db=%', v_in_var_cnt, v_db_var_cnt;
  END IF;

  SELECT count(*) INTO v_match_cnt
    FROM jsonb_array_elements(p_variant_paths) AS t(v_col)
    WHERE EXISTS (
      SELECT 1 FROM public.media_variants mv
       WHERE mv.id = t.v_col->>'variant_id' AND mv.asset_id = p_asset_id
    );
  IF v_match_cnt <> v_in_var_cnt THEN
    RAISE EXCEPTION 'some variant_id does not belong to asset %', p_asset_id;
  END IF;

  -- 翻转 original + variants 到 public canonical（不碰父 FK / is_public）
  UPDATE public.media_assets
     SET bucket = 'portfolio-public',
         original_path = p_public_original_path
   WHERE id = p_asset_id;
  GET DIAGNOSTICS v_aff = ROW_COUNT;
  IF v_aff <> 1 THEN
    RAISE EXCEPTION 'media_assets update affected % rows (expected 1)', v_aff;
  END IF;

  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths)
  LOOP
    UPDATE public.media_variants
       SET bucket = 'portfolio-public',
           variant_path = v_v->>'path'
     WHERE id = v_v->>'variant_id'
       AND asset_id = p_asset_id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'media_variants update affected % rows for % (expected 1)', v_aff, v_v->>'variant_id';
    END IF;
  END LOOP;

  v_result := jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'bucket', 'portfolio-public');
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


-- --- 函数 6 ---
CREATE OR REPLACE FUNCTION public.prepare_asset_private(
  p_asset_id              text,
  p_parent_type           text,
  p_parent_id             text,
  p_private_original_path text,
  p_variant_paths         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result      jsonb;
  v_v           jsonb;
  v_asset_cnt   int;
  v_parent_cnt  int;
  v_db_var_cnt  int;
  v_in_var_cnt  int;
  v_distinct_cnt int;
  v_match_cnt   int;
  v_aff         int;
  v_stage_prefix text;
  v_work_type   text;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_parent_type NOT IN ('work', 'certificate', 'avatar') THEN
    RAISE EXCEPTION 'invalid p_parent_type: %', p_parent_type;
  END IF;

  SELECT count(*) INTO v_asset_cnt FROM public.media_assets WHERE id = p_asset_id;
  IF v_asset_cnt <> 1 THEN
    RAISE EXCEPTION 'media_assets id not found or not unique: % (count=%)', p_asset_id, v_asset_cnt;
  END IF;

  IF p_parent_type = 'work' THEN
    SELECT count(*) INTO v_parent_cnt FROM public.works w WHERE w.id = p_parent_id;
    IF v_parent_cnt <> 1 THEN
      RAISE EXCEPTION 'work % not found', p_parent_id;
    END IF;
    SELECT w.type INTO v_work_type FROM public.works w WHERE w.id = p_parent_id;
    v_stage_prefix := 'staging/works/' || COALESCE(v_work_type, '') || '/';
  ELSIF p_parent_type = 'certificate' THEN
    SELECT count(*) INTO v_parent_cnt FROM public.certificates c WHERE c.id = p_parent_id;
    IF v_parent_cnt <> 1 THEN
      RAISE EXCEPTION 'certificate % not found', p_parent_id;
    END IF;
    v_stage_prefix := 'staging/certificates/';
  ELSIF p_parent_type = 'avatar' THEN
    v_stage_prefix := 'staging/avatars/';
  END IF;

  IF p_private_original_path IS NULL OR p_private_original_path = '' THEN
    RAISE EXCEPTION 'p_private_original_path is null/empty';
  END IF;
  IF p_private_original_path NOT LIKE (v_stage_prefix || '%') THEN
    RAISE EXCEPTION 'private original path must start with %: %', v_stage_prefix, p_private_original_path;
  END IF;

  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths)
  LOOP
    IF v_v->>'path' IS NULL OR v_v->>'path' = '' THEN
      RAISE EXCEPTION 'variant path is null/empty for %', v_v->>'variant_id';
    END IF;
    IF v_v->>'path' NOT LIKE (v_stage_prefix || '%') THEN
      RAISE EXCEPTION 'private variant path must start with %: %', v_stage_prefix, v_v->>'path';
    END IF;
  END LOOP;

  SELECT count(*) INTO v_in_var_cnt FROM jsonb_array_elements(p_variant_paths);
  SELECT count(DISTINCT t.v_col->>'variant_id') INTO v_distinct_cnt
    FROM jsonb_array_elements(p_variant_paths) AS t(v_col);
  IF v_in_var_cnt <> v_distinct_cnt THEN
    RAISE EXCEPTION 'duplicate variant_id in p_variant_paths';
  END IF;

  SELECT count(*) INTO v_db_var_cnt FROM public.media_variants WHERE asset_id = p_asset_id;
  IF v_in_var_cnt <> v_db_var_cnt THEN
    RAISE EXCEPTION 'variant set size mismatch: input=% db=%', v_in_var_cnt, v_db_var_cnt;
  END IF;

  SELECT count(*) INTO v_match_cnt
    FROM jsonb_array_elements(p_variant_paths) AS t(v_col)
    WHERE EXISTS (
      SELECT 1 FROM public.media_variants mv
       WHERE mv.id = t.v_col->>'variant_id' AND mv.asset_id = p_asset_id
    );
  IF v_match_cnt <> v_in_var_cnt THEN
    RAISE EXCEPTION 'some variant_id does not belong to asset %', p_asset_id;
  END IF;

  UPDATE public.media_assets
     SET bucket = 'portfolio-private',
         original_path = p_private_original_path
   WHERE id = p_asset_id;
  GET DIAGNOSTICS v_aff = ROW_COUNT;
  IF v_aff <> 1 THEN
    RAISE EXCEPTION 'media_assets update affected % rows (expected 1)', v_aff;
  END IF;

  FOR v_v IN SELECT * FROM jsonb_array_elements(p_variant_paths)
  LOOP
    UPDATE public.media_variants
       SET bucket = 'portfolio-private',
           variant_path = v_v->>'path'
     WHERE id = v_v->>'variant_id'
       AND asset_id = p_asset_id;
    GET DIAGNOSTICS v_aff = ROW_COUNT;
    IF v_aff <> 1 THEN
      RAISE EXCEPTION 'media_variants update affected % rows for % (expected 1)', v_aff, v_v->>'variant_id';
    END IF;
  END LOOP;

  v_result := jsonb_build_object('ok', true, 'asset_id', p_asset_id, 'bucket', 'portfolio-private');
  RETURN v_result;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


-- --- 函数 7 ---
CREATE OR REPLACE FUNCTION public.append_work_image(
  p_work_id        text,
  p_media_asset_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_asset_cnt int;
  v_work_cnt  int;
  v_max       int;
  v_new_id    text;
  v_dummy     int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT count(*) INTO v_asset_cnt FROM public.media_assets WHERE id = p_media_asset_id;
  IF v_asset_cnt <> 1 THEN
    RAISE EXCEPTION 'media_assets id not found or not unique: % (count=%)', p_media_asset_id, v_asset_cnt;
  END IF;

  SELECT count(*) INTO v_work_cnt FROM public.works WHERE id = p_work_id;
  IF v_work_cnt <> 1 THEN
    RAISE EXCEPTION 'work % not found', p_work_id;
  END IF;

  -- FOR UPDATE 锁定父 work 行，串行化并发追加（杜绝相同 max+1）
  SELECT 1 INTO v_dummy FROM public.works w WHERE w.id = p_work_id FOR UPDATE;

  SELECT COALESCE(max(sort_order), 0) INTO v_max FROM public.work_images WHERE work_id = p_work_id;
  v_new_id := 'wi-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.work_images (id, work_id, media_asset_id, sort_order, alt_text)
  VALUES (v_new_id, p_work_id, p_media_asset_id, v_max + 1, NULL);

  RETURN jsonb_build_object('ok', true, 'work_id', p_work_id, 'image_id', v_new_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


-- --- 函数 8 ---
CREATE OR REPLACE FUNCTION public.append_comic_page(
  p_work_id        text,
  p_media_asset_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_asset_cnt int;
  v_work_cnt  int;
  v_max_pn    int;
  v_max_so    int;
  v_new_id    text;
  v_dummy     int;
BEGIN
  IF NOT public.is_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT count(*) INTO v_asset_cnt FROM public.media_assets WHERE id = p_media_asset_id;
  IF v_asset_cnt <> 1 THEN
    RAISE EXCEPTION 'media_assets id not found or not unique: % (count=%)', p_media_asset_id, v_asset_cnt;
  END IF;

  SELECT count(*) INTO v_work_cnt FROM public.works WHERE id = p_work_id;
  IF v_work_cnt <> 1 THEN
    RAISE EXCEPTION 'work % not found', p_work_id;
  END IF;

  SELECT 1 INTO v_dummy FROM public.works w WHERE w.id = p_work_id FOR UPDATE;

  SELECT COALESCE(max(page_number), 0), COALESCE(max(sort_order), 0)
    INTO v_max_pn, v_max_so
    FROM public.comic_pages WHERE work_id = p_work_id;
  v_new_id := 'cp-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.comic_pages (id, work_id, media_asset_id, page_number, sort_order)
  VALUES (v_new_id, p_work_id, p_media_asset_id, v_max_pn + 1, v_max_so + 1);

  RETURN jsonb_build_object('ok', true, 'work_id', p_work_id, 'page_id', v_new_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;


-- ---- 权限（收回默认 + 仅赋 authenticated）----

REVOKE ALL ON FUNCTION public.publish_asset(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_asset(text, text, text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.unpublish_asset(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_asset(text, text, text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_work_image_and_reorder(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_work_image_and_reorder(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_comic_page_and_reorder(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_comic_page_and_reorder(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.prepare_asset_public(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_asset_public(text, text, text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.prepare_asset_private(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_asset_private(text, text, text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.append_work_image(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_work_image(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.append_comic_page(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_comic_page(text, text) TO authenticated;

-- 通知 PostgREST 重新加载 schema（必须，否则新函数对 API 不可见）
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 只读核验 SQL（粘贴执行，确认全部函数真实存在且 authenticated 有 EXECUTE）
-- 预期：下列 9 个函数均返回 1 行，authenticated_execute = true。
--   若某行缺失或 authenticated_execute = false，说明应用未成功，请勿进行真人操作。
-- ============================================================
SELECT
  p.proname  AS function_name,
  pg_get_function_identity_arguments(p.oid) AS signature,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'is_admin',
    'publish_asset',
    'unpublish_asset',
    'remove_work_image_and_reorder',
    'remove_comic_page_and_reorder',
    'prepare_asset_public',
    'prepare_asset_private',
    'append_work_image',
    'append_comic_page'
  )
ORDER BY p.proname;
