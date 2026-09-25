import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { go } from "@/lib/nav";
import { THEMES, STAGES, companyKey, stageLabel } from "@/lib/pitch-fields";

type Props = {
  companyName: string;
  founderName: string;
  country: string;
  theme: string;
  stage: string;
  pitchId: string | null;
};

const SuperLeagueInvite = ({ companyName, founderName, country, theme, stage, pitchId }: Props) => {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(true);
  const [already, setAlready] = useState(false);
  const [subtheme, setSubtheme] = useState("");
  const [advantage, setAdvantage] = useState("");
  const [founders, setFounders] = useState(founderName);
  const [city, setCity] = useState("");
  const [place, setPlace] = useState(country);
  const [chosenTheme, setChosenTheme] = useState(theme);
  const [chosenStage, setChosenStage] = useState(stage);
  const [revenue, setRevenue] = useState<"pre_revenue" | "generating" | "">("");
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const key = companyKey(companyName);
      if (!key) {
        setChecking(false);
        return;
      }
      const { data, error: lookupError } = await supabase
        .from("super_league")
        .select("id")
        .eq("company_key", key)
        .maybeSingle();
      if (cancelled) return;
      if (!lookupError && data) setAlready(true);
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [companyName]);

  const join = async () => {
    if (!subtheme.trim() || !advantage.trim() || !founders.trim() || !city.trim() || !place.trim() || !revenue || !logo) {
      setError("Add subtheme, a one-line advantage, founders, city, country, revenue, and a logo.");
      return;
    }
    setSending(true);
    setError(null);
    const ext = logo.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("super-league-logos")
      .upload(path, logo, { contentType: logo.type || undefined, upsert: false });
    if (uploadError) {
      setSending(false);
      setError(uploadError.message);
      return;
    }
    const { data: publicUrl } = supabase.storage.from("super-league-logos").getPublicUrl(path);
    const { data, error: joinError } = await supabase.rpc("join_super_league", {
      p_company_name: companyName.trim(),
      p_stage: chosenStage,
      p_theme: chosenTheme,
      p_subtheme: subtheme.trim(),
      p_advantage: advantage.trim(),
      p_founder_names: founders.trim(),
      p_country: place.trim(),
      p_city: city.trim(),
      p_revenue: revenue,
      p_logo_url: publicUrl.publicUrl,
      p_pitch_id: pitchId,
    });
    setSending(false);
    const result = data as { ok?: boolean; error?: string } | null;
    if (joinError) {
      setError(joinError.message);
      return;
    }
    if (!result?.ok) {
      if (result?.error === "already_listed") {
        setAlready(true);
        setOpen(false);
        return;
      }
      setError("Could not add this company. Check the fields and try again.");
      return;
    }
    setDone(true);
    setOpen(false);
  };

  if (checking) return null;

  if (already || done) {
    return (
      <div className="mt-10 border-t border-white/10 pt-6">
        <p className="text-xs uppercase tracking-[0.22em] text-primary">Super League</p>
        <p className="mt-2 text-sm text-white/70">
          {companyName.trim() || "This company"} is in the league. One record, no second listing.
        </p>
        <button type="button" onClick={() => go("/super-league")} className="mt-3 text-sm text-white/50 hover:text-white">
          Open the landscape
        </button>
      </div>
    );
  }

  return (
    <div className="mt-10 border-t border-white/10 pt-6">
      <p className="text-xs uppercase tracking-[0.22em] text-primary">Super League</p>
      <p className="mt-2 max-w-xl text-sm text-white/55">
        Want {companyName.trim() || "this company"} on the deal landscape? One listing per startup. Theme, stage, and country are already filled.
      </p>
      {!open ? (
        <Button type="button" onClick={() => setOpen(true)} className="pitch-launch mt-4">
          Add to Super League
        </Button>
      ) : (
        <div className="mt-6 grid max-w-xl gap-1">
          <input className="pitch-line" value={subtheme} onChange={(e) => setSubtheme(e.target.value)} placeholder="Subtheme" maxLength={80} />
          <input className="pitch-line" value={advantage} onChange={(e) => setAdvantage(e.target.value)} placeholder="One-line advantage" maxLength={180} />
          <input className="pitch-line" value={founders} onChange={(e) => setFounders(e.target.value)} placeholder="Founder names" />
          <input className="pitch-line" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
          <input className="pitch-line" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Country" />
          <select className={cn("pitch-line appearance-none", !chosenTheme && "text-white/35")} value={chosenTheme} onChange={(e) => setChosenTheme(e.target.value)}>
            {THEMES.map((item) => (
              <option key={item} value={item} className="bg-black text-white">{item}</option>
            ))}
          </select>
          <select className={cn("pitch-line appearance-none", !chosenStage && "text-white/35")} value={chosenStage} onChange={(e) => setChosenStage(e.target.value)}>
            {STAGES.map((item) => (
              <option key={item.value} value={item.value} className="bg-black text-white">{item.label}</option>
            ))}
          </select>
          <div className="flex gap-4 py-3 text-sm">
            <button type="button" onClick={() => setRevenue("pre_revenue")} className={revenue === "pre_revenue" ? "text-white" : "text-white/35"}>
              Pre-revenue
            </button>
            <button type="button" onClick={() => setRevenue("generating")} className={revenue === "generating" ? "text-primary" : "text-white/35"}>
              Generating revenue
            </button>
          </div>
          <label className="pitch-row cursor-pointer">
            <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-white/20 bg-black">
              {logoPreview ? <img src={logoPreview} alt="" className="h-full w-full object-cover" /> : <span className="h-2 w-2 rounded-full bg-white/40" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] text-white">Logo</span>
              <span className="block truncate text-xs text-white/40">{logo ? logo.name : "Square icon, PNG or SVG"}</span>
            </span>
            <span className="text-sm text-white/45">{logo ? "Replace" : "Add"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file && file.size > 2 * 1024 * 1024) {
                  setError("Logo must be under 2MB.");
                  return;
                }
                setError(null);
                setLogo(file);
                setLogoPreview(file ? URL.createObjectURL(file) : null);
              }}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="mt-2 flex items-center gap-4">
            <Button type="button" onClick={join} disabled={sending} className="pitch-launch">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : `List ${stageLabel(chosenStage)}`}
            </Button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-white/45 hover:text-white">
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SuperLeagueInvite;
