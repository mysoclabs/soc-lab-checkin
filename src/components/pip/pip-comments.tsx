import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";
import { formatPipDate } from "@/components/pip/pip-ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { addPipComment } from "@/lib/pip.functions";

// Shared by the PIP detail page and My PIP: everyone who can see the plan can read and add comments.
export function PipComments({ pipId }: { pipId: string }) {
  const queryClient = useQueryClient();
  const addFn = useServerFn(addPipComment);
  const [body, setBody] = useState("");
  const commentsQuery = useQuery({
    queryKey: ["pip-comments", pipId],
    queryFn: async () => {
      const { data, error } = await supabase.from("pip_comments").select("*").eq("pip_id", pipId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
  const add = useMutation({
    mutationFn: () => addFn({ data: { pipId, body } }),
    onSuccess: async () => { setBody(""); await queryClient.invalidateQueries({ queryKey: ["pip-comments", pipId] }); },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Unable to add comment"),
  });
  const comments = commentsQuery.data ?? [];

  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Visible to the employee, their manager and HR. Use HR notes for anything confidential.</p>
    {commentsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading comments…</p>
      : comments.length === 0 ? <div className="border-y border-dashed border-border py-8 text-center"><MessageSquareText className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="text-sm text-muted-foreground">No comments yet.</p></div>
      : <ul className="space-y-3">{comments.map((comment) => <li key={comment.id} className="border-l-2 border-border pl-3">
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{comment.author_role}</span> · {comment.author_email} · {formatPipDate(comment.created_at)}</p>
        <p className="mt-1 whitespace-pre-wrap text-sm">{comment.body}</p>
      </li>)}</ul>}
    <div className="flex flex-col gap-2 sm:flex-row">
      <Textarea aria-label="New comment" rows={2} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write a comment…" maxLength={3000} />
      <Button className="sm:self-end" disabled={!body.trim() || add.isPending} onClick={() => add.mutate()}><Send className="mr-2 h-4 w-4" />Comment</Button>
    </div>
  </div>;
}
