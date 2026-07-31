-- Aksor отдаёт DASH (.mpd), а не HLS — нужен отдельный флаг в кэше рядом с
-- is_hls, чтобы resolve.ts знал, каким путём (rewriteM3U8 vs
-- rewriteDashManifest) проксировать закэшированную запись без повторного
-- извлечения на VPS.
alter table resolved_streams add column if not exists is_dash boolean not null default false;
