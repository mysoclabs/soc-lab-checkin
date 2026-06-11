import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/students/$id")({
  head: () => ({ meta: [{ title: "Student Profile · MySOC Labs Attendance" }] }),
  component: StudentProfile,
});

function StudentProfile() {
  const { id } = useParams({ from: "/_authenticated/students/$id" });
  const [qrUrl, setQrUrl] = useState<string>("");
  const printRef = useRef<HTMLDivElement>(null);

  const { data: student, isLoading } = useQuery({
    queryKey: ["student", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("students").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!student) return;
    QRCode.toDataURL(student.student_id, { width: 512, margin: 2, color: { dark: "#0b1220", light: "#ffffff" } })
      .then(setQrUrl)
      .catch(console.error);
  }, [student]);

  const handleDownload = () => {
    if (!qrUrl || !student) return;
    const a = document.createElement("a");
    a.href = qrUrl;
    a.download = `${student.student_id}-qr.png`;
    a.click();
  };

  const handlePrint = () => {
    if (!student || !qrUrl) return;
    const w = window.open("", "_blank", "width=480,height=720");
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${student.student_id}</title>
      <style>
        body{font-family:system-ui,sans-serif;background:#fff;color:#0b1220;display:flex;align-items:center;justify-content:center;padding:40px;}
        .card{border:1px solid #0b1220;border-radius:16px;padding:24px;width:320px;text-align:center;}
        .brand{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#475569;}
        h1{font-size:20px;margin:8px 0 4px;}
        .id{font-family:ui-monospace,monospace;color:#475569;margin-bottom:16px;}
        img{width:240px;height:240px;}
        .meta{font-size:12px;color:#475569;margin-top:12px;}
      </style></head><body>
      <div class="card">
        <div class="brand">MySOC Labs</div>
        <h1>${student.name}</h1>
        <div class="id">${student.student_id}</div>
        <img src="${qrUrl}" />
        <div class="meta">${student.batch ?? ""}</div>
      </div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500);}</script>
      </body></html>`);
    w.document.close();
  };

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!student) return <p className="text-sm text-muted-foreground">Student not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link to="/students"><ArrowLeft className="mr-1 h-4 w-4" /> Back to students</Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Student Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Detail label="Full Name" value={student.name} />
            <Detail label="Student ID" value={student.student_id} mono />
            <Detail label="Email" value={student.email} />
            <Detail label="Phone Number" value={student.phone ?? "—"} />
            <Detail label="Batch" value={student.batch ?? "—"} />
            <Detail label="Enrolled" value={new Date(student.created_at).toLocaleDateString()} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>QR Code</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <div ref={printRef} className="rounded-lg bg-white p-3">
              {qrUrl ? <img src={qrUrl} alt="QR Code" width={224} height={224} /> : <div className="h-56 w-56" />}
            </div>
            <p className="font-mono text-xs text-muted-foreground">{student.student_id}</p>
            <div className="flex w-full flex-col gap-2">
              <Button onClick={handleDownload} variant="secondary"><Download className="mr-2 h-4 w-4" /> Download</Button>
              <Button onClick={handlePrint}><Printer className="mr-2 h-4 w-4" /> Print ID Card</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 ${mono ? "font-mono text-sm" : "text-base"}`}>{value}</p>
    </div>
  );
}
