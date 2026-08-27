-- ============================================================================
-- 001_schema.sql — Phase 3-B1 · 建表 + 索引 + 约束 + 触发器 + is_admin()
-- 架构基准：PHASE3_ARCHITECTURE.md Final-3.2a（唯一施工基准）
-- 执行顺序（严禁前向引用 FK）：
--   admin_users → media_assets → media_variants → works → work_images
--   → comic_pages → certificates → About 分表(profile/education/experience/skills/honors/contact_links)
-- 本文件只建结构 + is_admin() 函数；RLS 策略在 002_rls.sql；RPC 在 003_rpc.sql。
-- 禁止：任何 service_role / secret / 假 URL 写入；无数据 INSERT（数据见 scripts/seed-to-supabase.*）。
-- ============================================================================

-- ============ 枚举约束说明（与架构 §3 一致） ============
-- work_type:      'illustration' | 'comic' | 'oil'
-- work_nature:    'original' | 'fan' | NULL          （禁止 'fan-work'）
-- display_size:   'standard' | 'large-portrait' | 'wide-feature'
-- format:         'webp' | 'jpeg' | 'png'
-- bucket:         'portfolio-public' | 'portfolio-private'   （仅两个 bucket，无独立 avatars）

-- ============ ① admin_users（写权限白名单） ============
CREATE TABLE IF NOT EXISTS admin_users (
  uid         uuid PRIMARY KEY,               -- = Supabase Auth users.id
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============ ② media_assets（统一媒体资产，所有图片引用此表） ============
CREATE TABLE IF NOT EXISTS media_assets (
  id            text PRIMARY KEY,              -- 业务 ID（如 {work_id}__img{n} / {work_id}__p{nn} / cert-cert01 / avatar）
  bucket        text NOT NULL CHECK (bucket IN ('portfolio-public','portfolio-private')),
  original_path text NOT NULL,                -- 原图 Storage key（随 bucket）
  original_width  int,                        -- 原图宽
  original_height int,                        -- 原图高
  lqip_data_uri text,                         -- 40px WebP data-URI 即时占位（DB 字段，不进 Storage）
  format        text NOT NULL DEFAULT 'webp'
                 CHECK (format IN ('webp','jpeg','png')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ma_bucket ON media_assets(bucket);

-- ============ ③ media_variants（统一多尺寸衍生档） ============
CREATE TABLE IF NOT EXISTS media_variants (
  id           text PRIMARY KEY,              -- 固定 {asset_id}__{format}__{width}w（如 i01__webp__480w / i01__jpeg__480w）
  asset_id     text NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  bucket       text NOT NULL CHECK (bucket IN ('portfolio-public','portfolio-private')),
  variant_path text NOT NULL,                 -- 该档 Storage key
  format       text NOT NULL CHECK (format IN ('webp','jpeg','png')),
  width        int NOT NULL,                  -- 该档渲染宽度（如 480/960/1400）
  height       int NOT NULL,                  -- 该档渲染高度
  UNIQUE (asset_id, format, width)            -- 同资产同格式同宽不重复
);
CREATE INDEX IF NOT EXISTS ix_mv_asset ON media_variants(asset_id);

-- ============ ④ works ============
CREATE TABLE IF NOT EXISTS works (
  id              text PRIMARY KEY,           -- 现有业务 ID（i01..i18 / oil1 / oil2 / comic-*），禁 UUID
  slug            text UNIQUE NOT NULL,       -- 与 id 同值
  type            text NOT NULL CHECK (type IN ('illustration','comic','oil')),
  title           text NOT NULL,
  intro           text NOT NULL DEFAULT '',
  year            int,
  stage           text,
  work_nature     text CHECK (work_nature IS NULL OR work_nature IN ('original','fan')),
  cover_asset_id  text REFERENCES media_assets(id) ON DELETE SET NULL,
  is_public       boolean NOT NULL DEFAULT true,
  sort_order      int NOT NULL DEFAULT 0,
  home_featured   boolean NOT NULL DEFAULT false,
  home_featured_order int NOT NULL DEFAULT 0,
  works_pick      boolean NOT NULL DEFAULT false,
  works_pick_order    int NOT NULL DEFAULT 0,
  display_size    text NOT NULL DEFAULT 'standard'
                  CHECK (display_size IN ('standard','large-portrait','wide-feature')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_works_type_public ON works(type, is_public);
CREATE INDEX IF NOT EXISTS ix_works_home_featured ON works(home_featured) WHERE home_featured = true;
CREATE INDEX IF NOT EXISTS ix_works_works_pick ON works(works_pick) WHERE works_pick = true;
CREATE INDEX IF NOT EXISTS ix_works_sort ON works(sort_order DESC);

-- ============ ⑤ work_images ============
CREATE TABLE IF NOT EXISTS work_images (
  id            text PRIMARY KEY,
  work_id       text NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  media_asset_id text NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_order    int NOT NULL DEFAULT 0,
  alt_text      text
);
CREATE INDEX IF NOT EXISTS ix_wi_work ON work_images(work_id, sort_order);

-- ============ ⑥ comic_pages ============
CREATE TABLE IF NOT EXISTS comic_pages (
  id            text PRIMARY KEY,
  work_id       text NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  media_asset_id text NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  page_number   int NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  UNIQUE (work_id, page_number),
  UNIQUE (work_id, media_asset_id)
);
CREATE INDEX IF NOT EXISTS ix_cp_work ON comic_pages(work_id, page_number);

-- ============ ⑦ certificates ============
CREATE TABLE IF NOT EXISTS certificates (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  year          int,
  year_start    int,
  year_end      int,
  category      text,
  media_asset_id text NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  is_public     boolean NOT NULL DEFAULT true,
  sort_order    int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_cert_public ON certificates(is_public, sort_order);

-- ============ ⑧ About 分表 ============
CREATE TABLE IF NOT EXISTS profile (
  id            text PRIMARY KEY DEFAULT 'singleton',
  full_name     text NOT NULL DEFAULT '邱钰真',
  pinyin        text NOT NULL DEFAULT 'QIU YUZHEN',
  bio           text,
  avatar_asset_id text REFERENCES media_assets(id) ON DELETE SET NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_profile CHECK (id = 'singleton')
);

CREATE TABLE IF NOT EXISTS education_entries (
  id          text PRIMARY KEY,
  year_text   text,
  heading     text,
  detail      text,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_edu_sort ON education_entries(sort_order);

CREATE TABLE IF NOT EXISTS experience_entries (
  id          text PRIMARY KEY,
  year_text   text,
  heading     text,
  detail      text,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_exp_sort ON experience_entries(sort_order);

CREATE TABLE IF NOT EXISTS skills (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_skills_sort ON skills(sort_order);

CREATE TABLE IF NOT EXISTS honors (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  detail      text,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_honors_sort ON honors(sort_order);

CREATE TABLE IF NOT EXISTS contact_links (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  url         text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_contact_sort ON contact_links(sort_order);

-- ============ updated_at 触发器 ============
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_works_updated ON works;
CREATE TRIGGER trg_works_updated BEFORE UPDATE ON works
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_profile_updated ON profile;
CREATE TRIGGER trg_profile_updated BEFORE UPDATE ON profile
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============ 管理员白名单判定函数（安全 SECURITY DEFINER） ============
-- 详见 002_rls.sql 中的 GRANT/REVOKE 配套；此处先定义函数体。
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users WHERE public.admin_users.uid = auth.uid());
$$;
