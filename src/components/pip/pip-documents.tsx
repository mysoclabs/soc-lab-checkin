import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { formatPipDate } from "@/components/pip/pip-ui";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { addPipDocument, createPipDocumentUpload, deletePipDocument, getPipDocumentUrl, setPipDocumentShared, type PipDocumentType } from "@/lib/pip.functions";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 10 * 1024 * 1024;

// canManage: HR owner or Super Admin. Everyone else only sees documents shared with the employee (enforced by the database).
export function PipDocuments({ pipId, canManage }: { pipId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [shareNew, setShareNew] = useState(false);
  const startUploadFn = useServerFn(createPipDocumentUpload);
  const addFn = useServerFn(addPipDocument);
  const urlFn = useServerFn(getPipDocumentUrl);
  const shareFn = useServerFn(setPipDocumentShared);
  const deleteFn = useServerFn(deletePipDocument);
  const docsQuery = useQuery({
    queryKey: ["pip-documents", pipId],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_documents").select("*").eq("pip_id", pipId).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["pip-documents", pipId] });
  const onError = (error: unknown) => toast.error(error instanceof Error ? error.message : "Something went wrong");

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) throw new Error("Files must be 10 MB or smaller");
      if (!ACCEPT.split(",").includes(file.type)) throw new Error("Upload a PDF, image, Word or text file");
      const meta = { pipId, fileName: file.name, contentType: file.type as PipDocumentType, sizeBytes: file.size };
      const { path, token } = await startUploadFn({ data: meta });
      const { error } = await supabase.storage.from("pip-documents").uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (error) throw error;
      await addFn({ data: { ...meta, path, shared: shareNew } });
    },
    onSuccess: async () => { toast.success("Document uploaded"); await refresh(); },
    onError,
  });
  const download = useMutation({
    mutationFn: (documentId: string) => urlFn({ data: { documentId } }),
    onSuccess: ({ url }) => { window.location.assign(url); },
    onError,
  });
  const share = useMutation({ mutationFn: (input: { documentId: string; shared: boolean }) => shareFn({ data: input }), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (documentId: string) => deleteFn({ data: { documentId } }), onSuccess: refresh, onError });
  const docs = docsQuery.data ?? [];

  return <div className="space-y-4">
    {canManage && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border p-3">
      <div className="flex items-center gap-2"><Switch id="share-new-doc" checked={shareNew} onCheckedChange={setShareNew} /><Label htmlFor="share-new-doc">Share new uploads with the employee</Label></div>
      <input ref={fileInput} type="file" accept={ACCEPT} className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload.mutate(file); }} />
      <Button variant="outline" disabled={upload.isPending} onClick={() => fileInput.current?.click()}><Upload className="mr-2 h-4 w-4" />{upload.isPending ? "Uploading…" : "Upload document"}</Button>
    </div>}
    {docsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading documents…</p>
      : docs.length === 0 ? <p className="border-y border-dashed border-border py-8 text-center text-sm text-muted-foreground">No documents{canManage ? " uploaded yet" : " shared with you yet"}.</p>
      : <ul className="divide-y divide-border">{docs.map((doc) => <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 items-center gap-2"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="truncate text-sm font-medium">{doc.file_name}</p><p className="text-xs text-muted-foreground">{Math.max(1, Math.round(doc.size_bytes / 1024))} KB · {doc.uploaded_by_email} · {formatPipDate(doc.created_at)}</p></div></div>
        <div className="flex items-center gap-2">
          {canManage && <div className="flex items-center gap-2"><Switch id={`share-${doc.id}`} checked={doc.shared_with_employee} disabled={share.isPending} onCheckedChange={(shared) => share.mutate({ documentId: doc.id, shared })} /><Label htmlFor={`share-${doc.id}`} className="text-xs">Shared</Label></div>}
          <Button variant="ghost" size="sm" disabled={download.isPending} onClick={() => download.mutate(doc.id)}><Download className="mr-1 h-4 w-4" />Download</Button>
          {canManage && <Button variant="ghost" size="icon" aria-label={`Delete ${doc.file_name}`} disabled={remove.isPending} onClick={() => remove.mutate(doc.id)}><Trash2 className="h-4 w-4" /></Button>}
        </div>
      </li>)}</ul>}
  </div>;
}
