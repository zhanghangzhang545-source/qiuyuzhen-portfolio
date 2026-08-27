-- ============================================================
-- FINAL15: 原子删除 + 重排 RPC（P0-C）
-- ------------------------------------------------------------
-- 将「删除目标关联 + 规范化剩余项 sort_order」合并进单一 PostgreSQL 事务函数，
-- 杜绝原先 JS 端 DELETE → SELECT → UPSERT 三步之间的半成功 / 其它项错位。
-- 两个函数均 SECURITY DEFINER + is_admin() 守卫 + 异常统一返回 jsonb（ok=false, error），
-- 与 003_rpc.sql 的 publish_asset / unpublish_asset 风格一致，无 secret。
-- ============================================================

-- 删除作品多图中的一张，并在同一事务内按「删除前相对顺序」连续重排剩余图。
-- 仅删除 work_images 关联行（底层 Storage / media_assets 不物理销毁，符合 C3 不不可逆删除纪律）；
-- media_asset_id / alt_text 保持原值不变；A B C D E 删 C → A B D E（绝不其它图换位）。
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

-- 删除漫画页中的一页，并在同一事务内按「删除前相对顺序」连续重排剩余页。
-- page_number 保持原值不变（仅 sort_order 重排，图文顺序不脱节）。其余同上。
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

-- 收回默认 execute，仅赋给已认证（实际调用仍经 public.is_admin() 守卫）
REVOKE ALL ON FUNCTION public.remove_work_image_and_reorder(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_work_image_and_reorder(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.remove_comic_page_and_reorder(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.remove_comic_page_and_reorder(text, text) TO authenticated;
