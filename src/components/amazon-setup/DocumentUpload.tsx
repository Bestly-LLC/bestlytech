import { useState, useRef, useCallback } from 'react';
import { Upload, CheckCircle2, AlertCircle, X, FileText, Image, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { cn } from '@/lib/utils';

interface DocumentUploadProps {
  documentType: string;
  label: string;
  description?: string;
  required?: boolean;
  accept?: string;
}

export const DocumentUpload = ({
  documentType, label, description, required = false, accept = '.pdf,.jpg,.jpeg,.png',
}: DocumentUploadProps) => {
  const { formId, uploadedDocs, refreshDocs } = useIntakeForm();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingDoc = uploadedDocs.find(d => d.document_type === documentType);

  const handleFile = useCallback(async (file: File) => {
    if (!formId) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('File must be under 10MB');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const path = `${formId}/${documentType}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('intake-documents')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      // Remove old doc record if exists
      if (existingDoc) {
        const { error: delError } = await supabase.from('intake_documents').delete().eq('id', existingDoc.id);
        if (delError) throw delError;
      }

      const { error: insertError } = await supabase.from('intake_documents').insert({
        intake_id: formId,
        document_type: documentType,
        file_name: file.name,
        file_path: path,
        file_size: file.size,
        mime_type: file.type,
      });
      if (insertError) throw insertError;
      await refreshDocs();
    } catch (e: any) {
      const msg = e.message || 'Upload failed';
      if (msg.includes('mime') || msg.includes('type')) {
        setError('Invalid file type. Please upload a PDF, JPG, or PNG.');
      } else if (msg.includes('size') || msg.includes('too large')) {
        setError('File is too large. Maximum size is 10MB.');
      } else if (msg.includes('row-level security')) {
        setError('Permission denied. The form may have already been submitted.');
      } else {
        setError(msg);
      }
    } finally {
      setUploading(false);
    }
  }, [formId, documentType, existingDoc, refreshDocs]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const removeDoc = async () => {
    if (!existingDoc) return;
    try {
      await supabase.storage.from('intake-documents').remove([existingDoc.file_path]);
      const { error: delError } = await supabase.from('intake_documents').delete().eq('id', existingDoc.id);
      if (delError) throw delError;
      await refreshDocs();
    } catch (e: any) {
      setError(e.message || 'Failed to remove document');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const isImage = existingDoc?.mime_type?.startsWith('image/');

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}

      {existingDoc ? (
        <div className="flex items-center gap-3 p-3 border border-border rounded-lg bg-muted/30">
          {isImage ? <Image className="w-5 h-5 text-primary" /> : <FileText className="w-5 h-5 text-primary" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{existingDoc.file_name}</p>
            <p className="text-xs text-muted-foreground">{formatSize(existingDoc.file_size)}</p>
          </div>
          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={removeDoc}>
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
            uploading && 'pointer-events-none opacity-60'
          )}
        >
          <input ref={inputRef} type="file" accept={accept} onChange={onSelect} className="hidden" />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Uploading...</p>
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                Drag & drop or <span className="text-primary font-medium">browse</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">PDF, JPG, PNG — Max 10MB</p>
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
          <Button variant="link" size="sm" className="p-0 h-auto" onClick={() => inputRef.current?.click()}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
};
