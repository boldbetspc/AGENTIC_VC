-- Allow Word docs in pitch-materials (extracted as text by review-pitch).
-- PPTX/PDF/video/images were already allowed; this only extends the bucket mime list.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'image/png',
  'image/jpeg',
  'image/webp'
]
WHERE id = 'pitch-materials';
