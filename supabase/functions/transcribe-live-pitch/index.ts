import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "OPENAI_API_KEY is not configured" }, 500);

    const { file_path, file_name, file_mime } = await req.json();
    if (!file_path || typeof file_path !== "string") return json({ error: "file_path is required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: blob, error } = await supabase.storage.from("pitch-materials").download(file_path);
    if (error || !blob) return json({ error: "Could not read the recording" }, 400);
    if (blob.size > 24 * 1024 * 1024) return json({ error: "Recording is over 24MB. Keep it under 3 minutes." }, 400);

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const name = typeof file_name === "string" && file_name ? file_name : "live-pitch.webm";
    const mime = typeof file_mime === "string" && file_mime ? file_mime : "video/webm";

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), name);
    form.append("model", Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "whisper-1");
    form.append("prompt", "Founder live pitch. Startup, product, customers, traction.");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const errText = await res.text();
      return json({ error: `Transcription failed: ${res.status} ${errText.slice(0, 300)}` }, 502);
    }
    const data = await res.json();
    const transcript = String(data.text || "").trim();
    if (!transcript) return json({ error: "No speech detected. Try again closer to the mic." }, 422);
    return json({ transcript: transcript.slice(0, 12000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed";
    return json({ error: message }, 500);
  }
});
