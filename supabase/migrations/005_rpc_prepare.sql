-- ============================================================
-- FINAL16: 未关联资产「预发布 / 预下架」事务能力（P0-一）
-- ------------------------------------------------------------
-- 解决 _uploadAndLink(autoPublish) 与正式 publish_asset 的契约冲突：
--   publish_asset 要求 asset 已被 parent 引用（ownership guard），但「先发布新媒体、
--   后切换父 FK」的安全状态机中，发布时资产尚未被引用 → 必须用本 RPC。
--
-- prepare_asset_public / prepare_asset_private 与 publish_asset / unpublish_asset 同形（5 参数），
-- 但：
--   * 不校验 asset→parent ownership（允许「未关联资产」先把自己翻成 public/private）；
--   * 仍校验 is_admin() + parent_type 白名单 + parent 真实存在 + canonical 路径前缀
--     + variant set 完整性（数量 / 去重 / 归属 / 与 DB 一致）；
--   * 仅翻转 media_assets + media_variants 的 bucket / canonical path；
--   * 绝不修改 works.is_public / certificates.is_public；
--   * 绝不修改任何父 FK（cover_asset_id / work_images / comic_pages / media_asset_id）。
-- 这样「先 prepare（资产自身公开）→ 最后切换父 FK」可在无断图窗口下完成公开编辑，
-- 同时不破坏 publish_asset 的原有 ownership 守卫（禁止通过删 ownership 校验来省事）。
-- 风格、SECURITY DEFINER、is_admin 守卫、EXCEPTION 统一返回 jsonb、GRANT/REVOKE 与 003 一致。
-- ============================================================

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

-- 收回默认 execute，仅赋给已认证（实际调用仍经 public.is_admin() 守卫）
REVOKE ALL ON FUNCTION public.prepare_asset_public(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_asset_public(text, text, text, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.prepare_asset_private(text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_asset_private(text, text, text, text, jsonb) TO authenticated;
