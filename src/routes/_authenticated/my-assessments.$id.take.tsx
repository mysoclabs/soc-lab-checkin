import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Bookmark, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { logAssessmentEvent, saveAssessmentProgress, startAssessment, submitAssessment } from "@/lib/assessments.functions";

export const Route = createFileRoute("/_authenticated/my-assessments/$id/take")({
  head: () => ({ meta: [{ title: "Assessment · MySocLabs" }] }),
  component: TakePage,
});

type View = Extract<Awaited<ReturnType<typeof startAssessment>>, { submitted: false }>["view"];
type Ans = string | string[] | null;

function TakePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const start = useServerFn(startAssessment);
  const saveFn = useServerFn(saveAssessmentProgress);
  const logFn = useServerFn(logAssessmentEvent);
  const submitFn = useServerFn(submitAssessment);

  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Ans>>({});
  const [marked, setMarked] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const times = useRef<Record<string, number>>({});
  const qStart = useRef(Date.now());
  const dirty = useRef(false);
  const state = useRef({ answers, marked, idx });
  state.current = { answers, marked, idx };

  useEffect(() => {
    start({ data: { assessmentId: id } }).then((r) => {
      if (r.submitted) { navigate({ to: "/my-assessments/result/$attemptId", params: { attemptId: r.attemptId }, replace: true }); return; }
      setView(r.view);
      setAnswers((r.view.attempt.answers ?? {}) as Record<string, Ans>);
      setMarked((r.view.attempt.marked ?? []) as string[]);
      setIdx(Math.min(r.view.attempt.current_index ?? 0, r.view.questions.length - 1));
      times.current = (r.view.attempt.question_times ?? {}) as Record<string, number>;
    }).catch((e: Error) => setError(e.message));
  }, [id]);

  const tick = () => {
    if (!view) return;
    const q = view.questions[state.current.idx];
    if (!q) return;
    const now = Date.now();
    times.current[q.id] = (times.current[q.id] ?? 0) + (now - qStart.current) / 1000;
    qStart.current = now;
  };

  const persist = useCallback(async () => {
    if (!view || view.attempt.status !== "in_progress") return;
    tick();
    dirty.current = false;
    try {
      await saveFn({ data: { attemptId: view.attempt.id, answers: state.current.answers, marked: state.current.marked, current_index: state.current.idx, question_times: times.current } });
    } catch { dirty.current = true; }
  }, [view]);

  const log = useCallback((type: "focus_lost" | "focus_returned" | "copy" | "paste" | "right_click", duration: number | null = null) => {
    if (!view) return;
    logFn({ data: { attemptId: view.attempt.id, type, question_index: state.current.idx, duration_seconds: duration } }).catch(() => {});
  }, [view]);

  const doSubmit = useCallback(async (auto = false) => {
    if (!view || submitting) return;
    setSubmitting(true);
    await persist();
    try {
      const r = await submitFn({ data: { attemptId: view.attempt.id, auto } });
      toast.success(auto ? "Time's up — assessment submitted" : "Assessment submitted");
      navigate({ to: "/my-assessments/result/$attemptId", params: { attemptId: r.attemptId }, replace: true });
    } catch (e) { toast.error((e as Error).message); setSubmitting(false); }
  }, [view, submitting, persist]);

  // Timer
  useEffect(() => {
    if (!view) return;
    const end = new Date(view.deadline).getTime();
    const t = setInterval(() => {
      const r = Math.max(0, Math.round((end - Date.now()) / 1000));
      setRemaining(r);
      if (r === 0) { clearInterval(t); if (view.assessment.settings?.auto_submit !== false) doSubmit(true); }
    }, 1000);
    return () => clearInterval(t);
  }, [view, doSubmit]);

  // Periodic autosave
  useEffect(() => {
    if (!view) return;
    const t = setInterval(() => { if (dirty.current) persist(); }, 5000);
    return () => clearInterval(t);
  }, [view, persist]);

  // Activity logging
  useEffect(() => {
    if (!view) return;
    let lostAt: number | null = null;
    const lost = () => { if (lostAt == null) { lostAt = Date.now(); log("focus_lost"); } };
    const back = () => { if (lostAt != null) { log("focus_returned", Math.round((Date.now() - lostAt) / 1000)); lostAt = null; } };
    const vis = () => (document.hidden ? lost() : back());
    const copy = () => log("copy");
    const paste = () => log("paste");
    const ctx = (e: Event) => { e.preventDefault(); log("right_click"); };
    const unload = () => { persist(); };
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("blur", lost);
    window.addEventListener("focus", back);
    document.addEventListener("copy", copy);
    document.addEventListener("paste", paste);
    document.addEventListener("contextmenu", ctx);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("blur", lost);
      window.removeEventListener("focus", back);
      document.removeEventListener("copy", copy);
      document.removeEventListener("paste", paste);
      document.removeEventListener("contextmenu", ctx);
      window.removeEventListener("beforeunload", unload);
    };
  }, [view, log, persist]);

  if (error) return (
    <Card className="mx-auto max-w-lg"><CardContent className="space-y-4 p-6 text-center"><p>{error}</p><Button asChild variant="outline"><Link to="/my-assessments">Back to My Assessments</Link></Button></CardContent></Card>
  );
  if (!view) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const qs = view.questions;
  const q = qs[idx];
  const allowPrev = view.assessment.settings?.allow_previous !== false;
  const answeredCount = qs.filter((x) => { const a = answers[x.id]; return a != null && (Array.isArray(a) ? a.length > 0 : a.trim() !== ""); }).length;
  const setAns = (v: Ans) => { setAnswers((p) => ({ ...p, [q.id]: v })); dirty.current = true; };
  const goto = (n: number) => { if (n < 0 || n >= qs.length) return; if (n < idx && !allowPrev) return; tick(); setIdx(n); setTimeout(persist, 0); };
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0"), ss = String(remaining % 60).padStart(2, "0");
  const val = answers[q.id];

  const confirmSubmit = () => {
    const missing = qs.filter((x) => x.required && !(answers[x.id] != null && (Array.isArray(answers[x.id]) ? (answers[x.id] as string[]).length : String(answers[x.id]).trim())));
    const msg = missing.length ? `${missing.length} required question(s) are unanswered. Submit anyway?` : "Submit your assessment? You can't change answers afterwards.";
    if (confirm(msg)) doSubmit(false);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 select-none">
      <Card className="sticky top-16 z-10"><CardContent className="flex flex-wrap items-center gap-4 p-3">
        <h1 className="font-semibold">{view.assessment.title}</h1>
        <div className="flex-1"><Progress value={(answeredCount / qs.length) * 100} /><p className="mt-1 text-xs text-muted-foreground">{answeredCount}/{qs.length} answered</p></div>
        <div className={cn("flex items-center gap-1 font-mono text-lg", remaining < 60 && "text-destructive")}><Clock className="h-4 w-4" />{mm}:{ss}</div>
        <Button onClick={confirmSubmit} disabled={submitting}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit"}</Button>
      </CardContent></Card>

      <div className="grid gap-4 md:grid-cols-[1fr_220px]">
        <Card><CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between text-sm text-muted-foreground"><span>Question {idx + 1} of {qs.length} · {q.marks} mark{Number(q.marks) === 1 ? "" : "s"}{q.required ? " · required" : ""}</span>
            <Button size="sm" variant={marked.includes(q.id) ? "default" : "outline"} onClick={() => { setMarked((m) => (m.includes(q.id) ? m.filter((x) => x !== q.id) : [...m, q.id])); dirty.current = true; }}><Bookmark className="mr-1 h-3 w-3" />Mark for review</Button></div>
          <p className="whitespace-pre-wrap text-lg font-medium">{q.prompt}</p>
          {q.image_url && <img src={q.image_url} alt="" className="max-h-72 rounded border border-border" />}
          {(q.type === "mcq" || q.type === "multi") && (
            <div className="space-y-2">
              {(q.options as { id: string; text: string }[]).map((o) => {
                const sel = q.type === "mcq" ? val === o.id : Array.isArray(val) && val.includes(o.id);
                return (
                  <button key={o.id} onClick={() => setAns(q.type === "mcq" ? o.id : sel ? (val as string[]).filter((x) => x !== o.id) : [...(Array.isArray(val) ? val : []), o.id])}
                    className={cn("flex w-full items-center gap-3 rounded-md border p-3 text-left transition", sel ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
                    <span className={cn("h-4 w-4 shrink-0 border", q.type === "mcq" ? "rounded-full" : "rounded", sel ? "border-primary bg-primary" : "border-muted-foreground")} />{o.text}
                  </button>
                );
              })}
              {q.type === "multi" && <p className="text-xs text-muted-foreground">Select all that apply.</p>}
            </div>
          )}
          {q.type === "truefalse" && (
            <div className="grid grid-cols-2 gap-3">{["true", "false"].map((v) => <Button key={v} size="lg" variant={val === v ? "default" : "outline"} onClick={() => setAns(v)}>{v === "true" ? "True" : "False"}</Button>)}</div>
          )}
          {q.type === "short" && <Input value={(val as string) ?? ""} onChange={(e) => setAns(e.target.value)} placeholder="Your answer" className="select-text" />}
          {q.type === "theory" && <Textarea rows={10} value={(val as string) ?? ""} onChange={(e) => setAns(e.target.value)} placeholder="Write your answer" className="select-text" />}
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => goto(idx - 1)} disabled={idx === 0 || !allowPrev}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
            {idx < qs.length - 1 ? <Button onClick={() => goto(idx + 1)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button> : <Button onClick={confirmSubmit} disabled={submitting}>Submit</Button>}
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-3">
          <p className="mb-2 text-xs text-muted-foreground">Questions</p>
          <div className="grid grid-cols-5 gap-1.5">
            {qs.map((x, i) => {
              const a = answers[x.id]; const done = a != null && (Array.isArray(a) ? a.length > 0 : a.trim() !== "");
              return <button key={x.id} onClick={() => goto(i)} disabled={i < idx && !allowPrev}
                className={cn("h-9 rounded text-sm font-medium border", i === idx ? "border-primary" : "border-border", marked.includes(x.id) ? "bg-warning/30" : done ? "bg-success/25" : "bg-muted", "disabled:opacity-40")}>{i + 1}</button>;
            })}
          </div>
          <div className="mt-3 space-y-1 text-xs text-muted-foreground"><p><span className="mr-1 inline-block h-2 w-2 rounded bg-success/50" />Answered</p><p><span className="mr-1 inline-block h-2 w-2 rounded bg-warning/50" />Marked for review</p></div>
        </CardContent></Card>
      </div>
      {view.assessment.instructions && idx === 0 && <Card><CardContent className="whitespace-pre-wrap p-4 text-sm text-muted-foreground">{view.assessment.instructions}</CardContent></Card>}
    </div>
  );
}
