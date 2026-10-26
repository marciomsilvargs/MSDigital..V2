alter table public.stories
  add column if not exists crop_scale numeric not null default 1.0;

alter table public.stories
  add constraint stories_crop_scale_range check (crop_scale >= 1.0 and crop_scale <= 3.0);

