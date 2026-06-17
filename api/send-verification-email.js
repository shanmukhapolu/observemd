import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { physicianEmail, studentName, date, specialty, hours, token } = req.body || {};

  if (!physicianEmail || !token) {
    return res.status(400).json({ error: "Missing physicianEmail or token" });
  }

  // Build the verification link from the incoming request host so it works
  // across local, preview, and production deployments without hardcoding.
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];
  const host  = req.headers["x-forwarded-host"] || req.headers.host;
  const link  = `${proto}://${host}/verify.html?token=${encodeURIComponent(token)}`;

  const niceDate = date
    ? new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    : "—";

  try {
    await resend.emails.send({
      from: "ObserveMD <onboarding@resend.dev>",
      to: physicianEmail,
      subject: "Shadowing Verification Request – ObserveMD",
      html: `
        <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e2030;">
          <div style="background:linear-gradient(135deg,#8b5cf6,#06b6d4);height:6px;border-radius:6px 6px 0 0;"></div>
          <div style="border:1px solid #e2e4ee;border-top:none;border-radius:0 0 12px 12px;padding:32px;">
            <h2 style="margin:0 0 6px;font-size:20px;">Shadowing Verification Request</h2>
            <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.5;">
              ${escapeHtml(studentName || "A student")} has listed you as the supervising
              physician for a shadowing observation and is requesting your confirmation.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
              <tr><td style="padding:8px 0;color:#6b7280;width:120px;">Student</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(studentName || "—")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Date</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(niceDate)}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Specialty</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(specialty || "—")}</td></tr>
              <tr><td style="padding:8px 0;color:#6b7280;">Hours</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(String(hours ?? "—"))}</td></tr>
            </table>
            <a href="${link}" style="display:inline-block;padding:13px 22px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;">
              Verify Observation
            </a>
            <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;line-height:1.5;">
              This secure link is single-use and expires in 30 days. No account is required.<br/>
              If the button doesn't work, paste this link into your browser:<br/>
              <a href="${link}" style="color:#7c3aed;word-break:break-all;">${link}</a>
            </p>
          </div>
        </div>
      `,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("[v0] Resend error:", error);
    return res.status(500).json({ error: "Email failed" });
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
