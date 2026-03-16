
-- Fix 1: Add DELETE and UPDATE storage policies for intake-documents bucket
CREATE POLICY "Users can delete their intake docs"
ON storage.objects
FOR DELETE
USING (bucket_id = 'intake-documents');

CREATE POLICY "Users can update their intake docs"
ON storage.objects
FOR UPDATE
USING (bucket_id = 'intake-documents');
