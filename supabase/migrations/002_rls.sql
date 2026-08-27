-- ============================================================================
-- 002_rls.sql — Phase 3-B1 · RLS 策略 + Storage policies
-- 基准：PHASE3_ARCHITECTURE.md Final-3.2a §4
-- 关键：写权限仅经 is_admin()（SECURITY DEFINER）校验 admin_users 白名单；
--       禁止任何 FOR ALL/INSERT/UPDATE/DELETE 策略直接授予 authenticated 写 admin_users；
--       media_assets/media_variants 匿名仅读真正公开资产；仅两个 bucket。
-- ============================================================================

-- ============ is_admin() 权限收口 ============
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- ============ works ============
ALTER TABLE works ENABLE ROW LEVEL SECURITY;

CREATE POLICY works_select_public ON works
  FOR SELECT TO anon, authenticated
  USING (is_public = true);

CREATE POLICY works_write_admin ON works
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ============ work_images / comic_pages ============
ALTER TABLE work_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE comic_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY wi_select ON work_images FOR SELECT TO anon, authenticated
  USING ( EXISTS (SELECT 1 FROM works w WHERE w.id = work_images.work_id AND w.is_public = true) );
CREATE POLICY wi_write ON work_images FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY cp_select ON comic_pages FOR SELECT TO anon, authenticated
  USING ( EXISTS (SELECT 1 FROM works w WHERE w.id = comic_pages.work_id AND w.is_public = true) );
CREATE POLICY cp_write ON comic_pages FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- ============ certificates ============
ALTER TABLE certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY cert_select_public ON certificates
  FOR SELECT TO anon, authenticated USING (is_public = true);
CREATE POLICY cert_write_admin ON certificates
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============ admin_users 自身（白名单仅供读取，禁止任何客户端写） ============
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_users_ro ON admin_users FOR SELECT TO authenticated USING (is_admin());
-- 注：此处不创建任何 FOR INSERT/UPDATE/DELETE 策略。admin_users 仅由
--   (a) Supabase SQL Editor 手动执行 / (b) 本地迁移脚本(SUPABASE_DB_URL) / (c) 服务端 service_role
--   三种非浏览器途径写入，不经客户端 RLS。

-- ============ media_assets / media_variants（补齐媒体 RLS） ============
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY ma_select_public ON media_assets
  FOR SELECT TO anon, authenticated
  USING (
    bucket = 'portfolio-public'
    AND (
      EXISTS (SELECT 1 FROM works w WHERE w.cover_asset_id = media_assets.id AND w.is_public = true)
      OR EXISTS (SELECT 1 FROM work_images wi JOIN works w ON w.id = wi.work_id WHERE wi.media_asset_id = media_assets.id AND w.is_public = true)
      OR EXISTS (SELECT 1 FROM comic_pages cp JOIN works w ON w.id = cp.work_id WHERE cp.media_asset_id = media_assets.id AND w.is_public = true)
      OR EXISTS (SELECT 1 FROM certificates c WHERE c.media_asset_id = media_assets.id AND c.is_public = true)
      OR EXISTS (SELECT 1 FROM profile p WHERE p.avatar_asset_id = media_assets.id)
    )
  );

CREATE POLICY mv_select_public ON media_variants
  FOR SELECT TO anon, authenticated
  USING (
    bucket = 'portfolio-public'
    AND EXISTS (SELECT 1 FROM media_assets ma WHERE ma.id = media_variants.asset_id AND ma.bucket = 'portfolio-public')
    AND (
      EXISTS (SELECT 1 FROM works w WHERE w.cover_asset_id = media_variants.asset_id AND w.is_public = true)
      OR EXISTS (SELECT 1 FROM work_images wi JOIN works w ON w.id = wi.work_id WHERE wi.media_asset_id = media_variants.asset_id AND w.is_public = true)
      OR EXISTS (SELECT 1 FROM comic_pages cp JOIN works w ON w.id = cp.work_id WHERE cp.media_asset_id = media_variants.asset_id AND w.is_public = true)
      OR EXISTS (SELECT 1 FROM certificates c WHERE c.media_asset_id = media_variants.asset_id AND c.is_public = true)
      OR EXISTS (SELECT 1 FROM profile p WHERE p.avatar_asset_id = media_variants.asset_id)
    )
  );

CREATE POLICY ma_write_admin ON media_assets
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY mv_write_admin ON media_variants
  FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============ About 分表 ============
ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE education_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE honors ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY profile_ro ON profile FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY profile_rw_admin ON profile FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY education_ro ON education_entries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY education_rw_admin ON education_entries FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY experience_ro ON experience_entries FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY experience_rw_admin ON experience_entries FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY skills_ro ON skills FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY skills_rw_admin ON skills FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY honors_ro ON honors FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY honors_rw_admin ON honors FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

CREATE POLICY contact_ro ON contact_links FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY contact_rw_admin ON contact_links FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ============ Storage policies（仅两个 bucket） ============
-- portfolio-public：SELECT 公开；写仅 is_admin()
CREATE POLICY storage_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'portfolio-public');
CREATE POLICY storage_public_write ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'portfolio-public' AND public.is_admin())
  WITH CHECK (bucket_id = 'portfolio-public' AND public.is_admin());

-- portfolio-private：读/写均仅 is_admin()
CREATE POLICY storage_private_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'portfolio-private' AND public.is_admin())
  WITH CHECK (bucket_id = 'portfolio-private' AND public.is_admin());
