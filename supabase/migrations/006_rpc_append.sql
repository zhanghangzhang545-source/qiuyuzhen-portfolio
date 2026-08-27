-- ============================================================
-- FINAL16: 数据库级原子「追加」图片 / 漫画页（P0-八）
-- ------------------------------------------------------------
-- 替代原先 JS 端「SELECT max(sort_order) → +1 → INSERT」的并发不安全写法
-- （并发请求可得到相同 sort_order，导致 F5 后顺序漂移 / 重复排序值）。
-- 两个函数在单一事务内 FOR UPDATE 锁定父 work 行，串行化并发追加，
-- 计算 max+1 后插入；新增项永远稳定追加到末尾。
-- 与 004 风格一致：SECURITY DEFINER + is_admin() 守卫 + EXCEPTION 返回 jsonb。
-- ============================================================

-- 追加一张作品多图到末尾（sort_order = 当前最大 + 1）。返回新插入行的稳定 id。
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

-- 追加一页漫画到末尾（page_number = 当前最大 + 1，sort_order = 当前最大 + 1；二者始终对齐）。
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

-- 收回默认 execute，仅赋给已认证（实际调用仍经 public.is_admin() 守卫）
REVOKE ALL ON FUNCTION public.append_work_image(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_work_image(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.append_comic_page(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_comic_page(text, text) TO authenticated;
