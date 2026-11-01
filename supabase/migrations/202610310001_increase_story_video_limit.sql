-- Allow larger Story videos while keeping the upload bounded.
-- 100 MB is compatible with the practical limit for video Story uploads.
update storage.buckets
set file_size_limit = 104857600
where id = 'media';
