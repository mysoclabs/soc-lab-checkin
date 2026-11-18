import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, Check } from "lucide-react";
import { RoleGuard } from "@/components/role-guard";
import { adb, TYPE_LABELS, type Assessment, type Question } from "@/lib/assessments-db";
import { logAudit } from "@/lib/audit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/assessments/$id/edit")({
  validateSearch: z.object({ step: z.number().int().min(1).max(5).optional() }),
  head: () => ({ meta: [{ title: "Edit Assessment · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin"]} fallbackTo="/me">
      <Wizard />
    </RoleGuard>
  ),
});

const STEPS = ["Basic Information", "Question Builder", "Settings", "Assign Employees", "Review & Publish"];
const uid = () => Math.random().toString(36).slice(2, 10);
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function Wizard() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const step = search.step ?? 1;
  const go = (s: number) => navigate({ to: "/assessments/$id/edit", params: { id }, search: { step: s } });

  const { data: assessment } = useQuery({
    queryKey: ["assessment", id],
    queryFn: async () => {
      const { data, error } = await adb.from("assessments").select("*").eq("id", id).single();
      if (error) throw error;
      return data as Assessment;
    },
  });

  if (!assessment) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{assessment.title}</h1>
        <p className="text-sm text-muted-foreground">Status: {assessment.status}</p>
      </div>
      <ol className="grid grid-cols-5 gap-2">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button onClick={() => go(i + 1)} className={cn("w-full rounded-md border px-2 py-2 text-left text-xs transition", step === i + 1 ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted")}>
              <span className="block font-semibold">Step {i + 1}</span>
              <span className="hidden sm:block">{s}</span>
            </button>
          </li>
        ))}
      </ol>
      {step === 1 && <BasicStep a={assessment} onNext={() => go(2)} />}
      {step === 2 && <QuestionsStep a={assessment} onNext={() => go(3)} />}
      {step === 3 && <SettingsStep a={assessment} onNext={() => go(4)} />}
      {step === 4 && <AssignStep a={assessment} onNext={() => go(5)} />}
      {step === 5 && <ReviewStep a={assessment} />}
    </div>
  );
}

function useSaveAssessment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Assessment>) => {
      const { error } = await adb.from("assessments").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["assessment", id] }),
    onError: (e: Error) => toast.error(e.message),
  });
}

function BasicStep({ a, onNext }: { a: Assessment; onNext: () => void }) {
  const save = useSaveAssessment(a.id);
  const [f, setF] = useState({
    title: a.title, description: a.description ?? "", department: a.department ?? "", instructions: a.instructions ?? "",
    duration_minutes: a.duration_minutes, passing_percentage: Number(a.passing_percentage),
  });
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await adb.from("students").select("department");
      return [...new Set((data ?? []).map((d: any) => d.department).filter(Boolean))] as string[];
    },
  });
  const submit = async () => {
    if (!f.title.trim()) return toast.error("Assessment name is required");
    await save.mutateAsync({ ...f, department: f.department || null });
    await logAudit({ action: "Assessment Edited", entity: "assessment", entity_id: a.id, details: { title: f.title } });
    onNext();
  };
  return (
    <Card><CardHeader><CardTitle className="text-base">Basic Information</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1"><Label>Assessment Name</Label><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
        <div className="space-y-1"><Label>Description</Label><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
        <div className="space-y-1"><Label>Department</Label>
          <Select value={f.department || "__all"} onValueChange={(v) => setF({ ...f, department: v === "__all" ? "" : v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__all">All departments</SelectItem>{departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label>Instructions</Label><Textarea rows={4} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Duration (minutes)</Label><Input type="number" min={1} value={f.duration_minutes} onChange={(e) => setF({ ...f, duration_minutes: Math.max(1, Number(e.target.value)) })} /></div>
          <div className="space-y-1"><Label>Passing Percentage</Label><Input type="number" min={0} max={100} value={f.passing_percentage} onChange={(e) => setF({ ...f, passing_percentage: Math.min(100, Math.max(0, Number(e.target.value))) })} /></div>
        </div>
        <div className="flex justify-end"><Button onClick={submit} disabled={save.isPending}>Save & Continue</Button></div>
      </CardContent>
    </Card>
  );
}

const ESTIMATE: Record<Question["type"], number> = { mcq: 45, multi: 60, truefalse: 20, short: 60, theory: 240 };

function QuestionsStep({ a, onNext }: { a: Assessment; onNext: () => void }) {
  const [qs, setQs] = useState<Question[] | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const dirty = useRef<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    adb.from("assessment_questions").select("*").eq("assessment_id", a.id).order("position").then(({ data }: any) => setQs(data ?? []));
  }, [a.id]);

  const flush = async (list: Question[]) => {
    const ids = [...dirty.current];
    dirty.current.clear();
    if (!ids.length) return;
    setSaving("saving");
    const rows = list.filter((q) => ids.includes(q.id)).map(({ id, assessment_id, position, type, prompt, options, correct, marks, required, image_url }) => ({ id, assessment_id, position, type, prompt, options, correct, marks, required, image_url }));
    const { error } = await adb.from("assessment_questions").upsert(rows);
    if (error) { toast.error(error.message); setSaving("idle"); } else setSaving("saved");
  };

  const update = (list: Question[], changedIds: string[]) => {
    const withPos = list.map((q, i) => ({ ...q, position: i }));
    withPos.forEach((q, i) => { if (list[i].position !== i) dirty.current.add(q.id); });
    changedIds.forEach((i) => dirty.current.add(i));
    setQs(withPos);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(withPos), 800);
  };

  useEffect(() => () => { clearTimeout(timer.current); if (qs) flush(qs); }, [qs]); // flush on unmount

  if (!qs) return <p className="text-muted-foreground">Loading…</p>;

  const blank = (type: Question["type"]): Question => {
    const opts = type === "mcq" || type === "multi" ? [{ id: uid(), text: "Option 1" }, { id: uid(), text: "Option 2" }] : [];
    return { id: crypto.randomUUID(), assessment_id: a.id, position: qs.length, type, prompt: "", options: opts, correct: type === "truefalse" ? ["true"] : [], marks: 1, required: true, image_url: null };
  };
  const set = (id: string, patch: Partial<Question>) => update(qs.map((q) => (q.id === id ? { ...q, ...patch } : q)), [id]);
  const removeQ = async (id: string) => {
    setQs(qs.filter((q) => q.id !== id).map((q, i) => ({ ...q, position: i })));
    dirty.current.delete(id);
    await adb.from("assessment_questions").delete().eq("id", id);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= qs.length) return;
    const n = [...qs];
    [n[i], n[j]] = [n[j], n[i]];
    update(n, [n[i].id, n[j].id]);
  };
  const dup = (i: number) => {
    const c = { ...qs[i], id: crypto.randomUUID(), options: qs[i].options.map((o) => ({ ...o })) };
    const n = [...qs.slice(0, i + 1), c, ...qs.slice(i + 1)];
    update(n, [c.id]);
  };

  const totalMarks = qs.reduce((s, q) => s + Number(q.marks || 0), 0);
  const est = Math.ceil(qs.reduce((s, q) => s + ESTIMATE[q.type], 0) / 60);

  const next = async () => {
    clearTimeout(timer.current);
    await flush(qs);
    const bad = qs.findIndex((q) => !q.prompt.trim() || (q.type !== "theory" && q.correct.length === 0));
    if (bad >= 0) return toast.error(`Question ${bad + 1} needs text and a correct answer`);
    onNext();
  };

  return (
    <div className="space-y-4">
      <Card className="sticky top-16 z-10"><CardContent className="flex flex-wrap items-center gap-4 p-3 text-sm">
        <span><b>{qs.length}</b> questions</span><span><b>{totalMarks}</b> marks</span><span>~<b>{est}</b> min estimated</span>
        <span className="ml-auto text-xs text-muted-foreground">{saving === "saving" ? "Saving…" : saving === "saved" ? "All changes saved" : ""}</span>
      </CardContent></Card>

      {qs.map((q, i) => (
        <Card key={q.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">Q{i + 1}</Badge>
              <Select value={q.type} onValueChange={(v) => {
                const t = v as Question["type"];
                const b = blank(t);
                set(q.id, { type: t, options: t === "mcq" || t === "multi" ? (q.options.length ? q.options : b.options) : [], correct: b.correct });
              }}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex items-center gap-1"><Label className="text-xs">Marks</Label><Input className="w-20" type="number" min={0} value={q.marks} onChange={(e) => set(q.id, { marks: Math.max(0, Number(e.target.value)) })} /></div>
              <div className="flex items-center gap-2"><Switch checked={q.required} onCheckedChange={(v) => set(q.id, { required: v })} /><Label className="text-xs">Required</Label></div>
              <div className="ml-auto flex gap-1">
                <Button size="icon" variant="ghost" aria-label="Move up" onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Move down" onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Duplicate" onClick={() => dup(i)}><Copy className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => removeQ(q.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </div>
            <Textarea placeholder="Question" value={q.prompt} onChange={(e) => set(q.id, { prompt: e.target.value })} />
            <Input placeholder="Optional image link (https://…)" value={q.image_url ?? ""} onChange={(e) => set(q.id, { image_url: e.target.value || null })} />
            {q.image_url && <img src={q.image_url} alt="" className="max-h-48 rounded border border-border" />}

            {(q.type === "mcq" || q.type === "multi") && (
              <div className="space-y-2">
                {q.options.map((o, oi) => {
                  const isCorrect = q.correct.includes(o.id);
                  return (
                    <div key={o.id} className="flex items-center gap-2">
                      <button aria-label="Mark correct" onClick={() => set(q.id, { correct: q.type === "mcq" ? [o.id] : isCorrect ? q.correct.filter((c) => c !== o.id) : [...q.correct, o.id] })}
                        className={cn("flex h-6 w-6 shrink-0 items-center justify-center border", q.type === "mcq" ? "rounded-full" : "rounded", isCorrect ? "border-success bg-success text-success-foreground" : "border-border")}>
                        {isCorrect && <Check className="h-3 w-3" />}
                      </button>
                      <Input value={o.text} onChange={(e) => set(q.id, { options: q.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })} placeholder={`Option ${oi + 1}`} />
                      <Button size="icon" variant="ghost" aria-label="Remove option" disabled={q.options.length <= 2} onClick={() => set(q.id, { options: q.options.filter((x) => x.id !== o.id), correct: q.correct.filter((c) => c !== o.id) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  );
                })}
                <Button size="sm" variant="outline" onClick={() => set(q.id, { options: [...q.options, { id: uid(), text: `Option ${q.options.length + 1}` }] })}><Plus className="mr-1 h-3 w-3" />Add option</Button>
                <p className="text-xs text-muted-foreground">Click the circle/box to mark {q.type === "mcq" ? "the correct answer" : "all correct answers"}.</p>
              </div>
            )}
            {q.type === "truefalse" && (
              <div className="flex gap-2">
                {["true", "false"].map((v) => (
                  <Button key={v} size="sm" variant={q.correct[0] === v ? "default" : "outline"} onClick={() => set(q.id, { correct: [v] })}>{v === "true" ? "True" : "False"}</Button>
                ))}
              </div>
            )}
            {q.type === "short" && (
              <div className="space-y-1">
                <Label className="text-xs">Accepted answers (one per line; case and extra spaces are ignored)</Label>
                <Textarea value={q.correct.join("\n")} onChange={(e) => set(q.id, { correct: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })} />
              </div>
            )}
            {q.type === "theory" && <p className="text-xs text-muted-foreground">Employees type a long answer. You'll award marks manually in the results.</p>}
          </CardContent>
        </Card>
      ))}

      <div className="flex flex-wrap gap-2">
        {(Object.keys(TYPE_LABELS) as Question["type"][]).map((t) => (
          <Button key={t} variant="outline" size="sm" onClick={() => { const b = blank(t); update([...qs, b], [b.id]); }}><Plus className="mr-1 h-3 w-3" />{TYPE_LABELS[t]}</Button>
        ))}
      </div>
      <div className="flex justify-end"><Button onClick={next} disabled={qs.length === 0}>Continue</Button></div>
    </div>
  );
}

function SettingsStep({ a, onNext }: { a: Assessment; onNext: () => void }) {
  const save = useSaveAssessment(a.id);
  const [s, setS] = useState(a.settings);
  const [avail, setAvail] = useState(toLocal(a.available_from));
  const [due, setDue] = useState(toLocal(a.due_at));
  const toggles: [keyof Assessment["settings"], string][] = [
    ["randomize_questions", "Randomize Question Order"], ["randomize_options", "Randomize Option Order"],
    ["allow_previous", "Allow Previous Question"], ["auto_submit", "Auto Submit on Timer End"], ["show_results", "Show Correct Answers After Submission"],
  ];
  const submit = async () => {
    if (avail && due && new Date(due) <= new Date(avail)) return toast.error("Due date must be after the availability date");
    await save.mutateAsync({ settings: s, available_from: fromLocal(avail), due_at: fromLocal(due) });
    onNext();
  };
  return (
    <Card><CardHeader><CardTitle className="text-base">Assessment Settings</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {toggles.map(([k, l]) => (
          <div key={k} className="flex items-center justify-between rounded-md border border-border p-3"><Label>{l}</Label><Switch checked={!!s[k]} onCheckedChange={(v) => setS({ ...s, [k]: v })} /></div>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1"><Label>Availability Date</Label><Input type="datetime-local" value={avail} onChange={(e) => setAvail(e.target.value)} /></div>
          <div className="space-y-1"><Label>Due Date</Label><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        </div>
        <div className="flex justify-end"><Button onClick={submit} disabled={save.isPending}>Save & Continue</Button></div>
      </CardContent>
    </Card>
  );
}

function AssignStep({ a, onNext }: { a: Assessment; onNext: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"company" | "department" | "specific">("specific");
  const [dept, setDept] = useState(a.department ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["assign-data", a.id],
    queryFn: async () => {
      const [e, asg] = await Promise.all([
        adb.from("students").select("id,name,email,department,student_id").order("name"),
        adb.from("assessment_assignments").select("student_id").eq("assessment_id", a.id),
      ]);
      return { employees: (e.data ?? []) as any[], assigned: new Set<string>((asg.data ?? []).map((x: any) => x.student_id)) };
    },
  });
  useEffect(() => { if (data) setPicked(new Set(data.assigned)); }, [data]);

  const employees = data?.employees ?? [];
  const departments = useMemo(() => [...new Set(employees.map((e) => e.department).filter(Boolean))] as string[], [employees]);
  const target = mode === "company" ? employees : mode === "department" ? employees.filter((e) => e.department === dept) : employees.filter((e) => picked.has(e.id));

  const save = useMutation({
    mutationFn: async () => {
      const ids = new Set(target.map((e) => e.id));
      const toRemove = [...(data?.assigned ?? [])].filter((x) => !ids.has(x));
      if (toRemove.length) await adb.from("assessment_assignments").delete().eq("assessment_id", a.id).in("student_id", toRemove);
      const rows = target.map((e) => ({ assessment_id: a.id, student_id: e.id, email: e.email }));
      if (rows.length) {
        const { error } = await adb.from("assessment_assignments").upsert(rows, { onConflict: "assessment_id,student_id" });
        if (error) throw error;
      }
      await logAudit({ action: `${rows.length} Employees Assigned`, entity: "assessment", entity_id: a.id, details: { title: a.title } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assign-data", a.id] }); toast.success(`${target.length} employees assigned`); onNext(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = employees.filter((e) => `${e.name} ${e.email} ${e.department ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <Card><CardHeader><CardTitle className="text-base">Assign Employees</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["company", "department", "specific"] as const).map((m) => (
            <Button key={m} size="sm" variant={mode === m ? "default" : "outline"} onClick={() => setMode(m)}>{m === "company" ? "Entire Company" : m === "department" ? "Department" : "Specific Employees"}</Button>
          ))}
        </div>
        {mode === "department" && (
          <Select value={dept} onValueChange={setDept}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Choose department" /></SelectTrigger>
            <SelectContent>{departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {mode === "specific" && (
          <div className="space-y-2">
            <Input placeholder="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-md border border-border p-2">
              {filtered.map((e) => (
                <label key={e.id} className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 hover:bg-muted">
                  <Checkbox checked={picked.has(e.id)} onCheckedChange={(v) => { const n = new Set(picked); v ? n.add(e.id) : n.delete(e.id); setPicked(n); }} />
                  <span className="text-sm">{e.name}</span><span className="text-xs text-muted-foreground">{e.department ?? ""} · {e.email}</span>
                </label>
              ))}
              {filtered.length === 0 && <p className="p-2 text-sm text-muted-foreground">No employees found.</p>}
            </div>
          </div>
        )}
        <p className="text-sm text-muted-foreground">{target.length} employees will be assigned.</p>
        <div className="flex justify-end"><Button onClick={() => save.mutate()} disabled={save.isPending || target.length === 0}>Save & Continue</Button></div>
      </CardContent>
    </Card>
  );
}

function ReviewStep({ a }: { a: Assessment }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["review", a.id],
    queryFn: async () => {
      const [q, asg] = await Promise.all([
        adb.from("assessment_questions").select("marks").eq("assessment_id", a.id),
        adb.from("assessment_assignments").select("email").eq("assessment_id", a.id),
      ]);
      return { qCount: q.data?.length ?? 0, marks: (q.data ?? []).reduce((s: number, x: any) => s + Number(x.marks), 0), assignees: (asg.data ?? []) as { email: string }[] };
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      if (!data?.qCount) throw new Error("Add at least one question first");
      if (!data.assignees.length) throw new Error("Assign at least one employee first");
      const { error } = await adb.from("assessments").update({ status: "published", published_at: new Date().toISOString() }).eq("id", a.id);
      if (error) throw error;
      await logAudit({ action: "Assessment Published", entity: "assessment", entity_id: a.id, details: { title: a.title } });
    },
    onSuccess: () => { toast.success("Assessment published"); qc.invalidateQueries({ queryKey: ["assessment", a.id] }); navigate({ to: "/assessments" }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows: [string, string | number][] = [
    ["Name", a.title], ["Department", a.department || "All"], ["Duration", `${a.duration_minutes} minutes`], ["Passing", `${a.passing_percentage}%`],
    ["Questions", data?.qCount ?? "…"], ["Total marks", data?.marks ?? "…"], ["Employees assigned", data?.assignees.length ?? "…"],
    ["Available from", a.available_from ? new Date(a.available_from).toLocaleString() : "Immediately"], ["Due", a.due_at ? new Date(a.due_at).toLocaleString() : "No due date"],
    ["Randomize questions", a.settings.randomize_questions ? "Yes" : "No"], ["Randomize options", a.settings.randomize_options ? "Yes" : "No"],
    ["Allow previous", a.settings.allow_previous ? "Yes" : "No"], ["Auto submit", a.settings.auto_submit ? "Yes" : "No"], ["Show correct answers", a.settings.show_results ? "Yes" : "No"],
  ];
  return (
    <Card><CardHeader><CardTitle className="text-base">Review & Publish</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {rows.map(([k, v]) => <div key={k} className="flex justify-between border-b border-border py-1 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{v}</dd></div>)}
        </dl>
        <div className="flex justify-end gap-2">
          {a.status === "draft" ? <Button onClick={() => publish.mutate()} disabled={publish.isPending}>Publish Assessment</Button> : <Badge>Already {a.status}</Badge>}
        </div>
      </CardContent>
    </Card>
  );
}
