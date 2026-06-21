import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import QRCode from "qrcode";
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Download, Printer, Search, QrCode } from "lucide-react";
import { toast } from "sonner";
import { RoleGuard } from "@/components/role-guard";

export const Route = createFileRoute("/_authenticated/students/bulk-qr")({
  head: () => ({ meta: [{ title: "Bulk QR Codes · MySocLabs" }] }),
  component: () => (
    <RoleGuard allow={["super_admin", "hr_admin"]} fallbackTo="/me">
      <BulkQrPage />
    </RoleGuard>
  ),
});

type Row = {
  id: string;
  student_id: string;
  name: string;
  email: string;
  department: string | null;
  designation: string | null;
};

async function qrDataUrl(code: string) {
  return QRCode.toDataURL(code, {
    width: 512,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#0b1220", light: "#ffffff" },
  });
}

function BulkQrPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ["students-bulk-qr"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, student_id, name, email, department, designation")
        .order("name");
      if (error) throw error;
      return data as Row[];
    },
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      [e.name, e.student_id, e.email, e.department, e.designation]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [employees, query]);

  const selectedEmployees = useMemo(
    () => employees.filter((e) => selected.has(e.id)),
    [employees, selected],
  );

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allFilteredSelected) filtered.forEach((e) => next.delete(e.id));
    else filtered.forEach((e) => next.add(e.id));
    setSelected(next);
  };

  const handleDownloadZip = async () => {
    if (selectedEmployees.length === 0) return toast.error("Select at least one employee");
    setBusy(true);
    try {
      const zip = new JSZip();
      for (const emp of selectedEmployees) {
        const url = await qrDataUrl(emp.student_id);
        const b64 = url.split(",")[1];
        const safeName = emp.name.replace(/[^a-z0-9-_]+/gi, "_");
        zip.file(`${emp.student_id}_${safeName}.png`, b64, { base64: true });
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      a.download = `mysoc-qr-codes-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(href);
      toast.success(`Downloaded ${selectedEmployees.length} QR codes`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePrint = async () => {
    if (selectedEmployees.length === 0) return toast.error("Select at least one employee");
    setBusy(true);
    try {
      const cards = await Promise.all(
        selectedEmployees.map(async (emp) => {
          const url = await qrDataUrl(emp.student_id);
          const meta = [emp.designation, emp.department].filter(Boolean).join(" · ");
          return `
            <div class="card">
              <div class="brand">MySocLabs</div>
              <h1>${escapeHtml(emp.name)}</h1>
              <div class="id">${escapeHtml(emp.student_id)}</div>
              <img class="qr" src="${url}" />
              ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}
            </div>`;
        }),
      );
      const w = window.open("", "_blank", "width=900,height=1100");
      if (!w) return;
      w.document.write(`<!doctype html><html><head><title>Bulk QR Codes</title>
        <style>
          @page { size: A4; margin: 12mm; }
          body{font-family:system-ui,sans-serif;background:#fff;color:#0b1220;margin:0;padding:0;}
          .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12mm;}
          .card{border:1px solid #0b1220;border-radius:12px;padding:16px;text-align:center;break-inside:avoid;page-break-inside:avoid;}
          .brand{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#475569;}
          h1{font-size:16px;margin:6px 0 2px;}
          .id{font-family:ui-monospace,monospace;color:#475569;margin-bottom:10px;font-size:12px;}
          img.qr{width:180px;height:180px;}
          .meta{font-size:11px;color:#475569;margin-top:8px;}
          @media print{ .grid{gap:8mm;} }
        </style></head><body>
        <div class="grid">${cards.join("")}</div>
        <script>window.onload=()=>{setTimeout(()=>{window.print();},250);}</script>
        </body></html>`);
      w.document.close();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Print failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/students"><ArrowLeft className="mr-1 h-4 w-4" /> Back to employees</Link>
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <QrCode className="h-6 w-6" /> Bulk QR Codes
          </h1>
          <p className="text-sm text-muted-foreground">
            Select employees to download or print their QR codes in bulk.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleDownloadZip} disabled={busy || selected.size === 0} variant="secondary">
            <Download className="mr-2 h-4 w-4" /> Download ZIP ({selected.size})
          </Button>
          <Button onClick={handlePrint} disabled={busy || selected.size === 0}>
            <Printer className="mr-2 h-4 w-4" /> Print ({selected.size})
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Employees</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, ID, email, department…"
              className="pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAll} />
              Select all ({filtered.length})
            </label>
            {selected.size > 0 && (
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear selection
              </button>
            )}
          </div>

          <div className="divide-y divide-border rounded-md border border-border">
            {isLoading ? (
              <p className="p-4 text-sm text-muted-foreground">Loading…</p>
            ) : filtered.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No employees found.</p>
            ) : (
              filtered.map((e) => (
                <label
                  key={e.id}
                  className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/40"
                >
                  <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{e.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-mono">{e.student_id}</span>
                      {e.department ? ` · ${e.department}` : ""}
                      {e.designation ? ` · ${e.designation}` : ""}
                    </p>
                  </div>
                </label>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
