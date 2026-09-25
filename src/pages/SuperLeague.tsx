import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { go } from "@/lib/nav";
import { STAGES, THEMES, stageLabel } from "@/lib/pitch-fields";

export type LeagueStartup = {
  id: string;
  company_name: string;
  stage: string;
  theme: string;
  subtheme: string;
  advantage: string;
  founder_names: string;
  country: string;
  city: string;
  logo_url: string | null;
  revenue: "pre_revenue" | "generating";
};

type ViewMode = "orbits" | "terrain" | "list";

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "list", label: "List" },
  { id: "orbits", label: "Orbits" },
  { id: "terrain", label: "Heatmap" },
];

const PHASE_RADIUS = [46, 82, 118, 154];

function revenueLabel(revenue: LeagueStartup["revenue"]) {
  return revenue === "generating" ? "Generating revenue" : "Pre-revenue";
}

function Mark({
  startup,
  active,
  onSelect,
}: {
  startup: LeagueStartup;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const live = startup.revenue === "generating";
  return (
    <button
      type="button"
      onClick={() => onSelect(startup.id)}
      className={cn(
        "group flex w-[148px] flex-col items-center text-center transition-transform duration-300",
        active ? "scale-[1.04]" : "hover:scale-[1.03]",
      )}
    >
      <span className="relative grid h-14 w-14 place-items-center" aria-hidden>
        <span
          className={cn(
            "absolute inset-0 rounded-full",
            live ? "bg-primary/20" : "bg-white/5",
            active && "bg-primary/30",
          )}
        />
        <span
          className={cn(
            "absolute inset-1 overflow-hidden rounded-full border bg-black",
            active ? "border-primary" : live ? "border-primary/70" : "border-white/25",
          )}
        >
          {startup.logo_url ? (
            <img src={startup.logo_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className={cn("absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full", live || active ? "bg-primary" : "bg-white/70")} />
          )}
        </span>
      </span>
      <span className="mt-3 line-clamp-2 text-base font-medium leading-snug text-white">{startup.company_name}</span>
      <span className="mt-1 line-clamp-2 text-xs leading-snug text-white/45">{startup.advantage}</span>
      <span className="mt-2 text-[10px] uppercase tracking-[0.18em] text-primary">{stageLabel(startup.stage)}</span>
    </button>
  );
}

function Detail({
  startup,
  removing,
  onClose,
  onDelete,
}: {
  startup: LeagueStartup;
  removing: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const rows = [
    ["Phase", stageLabel(startup.stage)],
    ["Theme", startup.theme],
    ["Subtheme", startup.subtheme],
    ["Revenue", revenueLabel(startup.revenue)],
    ["Founders", startup.founder_names],
    ["Place", `${startup.city}, ${startup.country}`],
  ];
  return (
    <aside className="animate-fade-in pt-2">
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          {startup.logo_url && (
            <img src={startup.logo_url} alt="" className="h-14 w-14 rounded-full border border-white/15 object-cover" />
          )}
          <div>
          <p className="text-xs uppercase tracking-[0.22em] text-primary">{startup.theme}</p>
          <h2 className="mt-2 text-3xl font-medium tracking-tight text-white">{startup.company_name}</h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-white/75">{startup.advantage}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          <button type="button" onClick={onDelete} disabled={removing} className="text-sm text-white/40 hover:text-white">
            {removing ? "Removing…" : "Delete"}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-white hover:text-primary">
            Back
          </button>
        </div>
      </div>
      <dl className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="border-b border-white/10 pb-3">
            <dt className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</dt>
            <dd className="mt-1 text-sm text-white">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function Node({
  startup,
  onSelect,
  style,
}: {
  startup: LeagueStartup;
  onSelect: (id: string) => void;
  style?: CSSProperties;
}) {
  const live = startup.revenue === "generating";
  return (
    <button
      type="button"
      onClick={() => onSelect(startup.id)}
      style={style}
      title={startup.advantage}
      className="flex w-[96px] flex-col items-center text-center"
    >
      <span className={cn("grid h-10 w-10 place-items-center overflow-hidden rounded-full border bg-black", live ? "border-primary shadow-[0_0_16px_hsl(192_92%_64%/0.55)]" : "border-white/25")}>
        {startup.logo_url ? (
          <img src={startup.logo_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className={cn("h-2 w-2 rounded-full", live ? "bg-primary" : "bg-white/70")} />
        )}
      </span>
      <span className="mt-2 line-clamp-2 w-full text-sm font-medium leading-snug text-white">{startup.company_name}</span>
    </button>
  );
}

function ListView({ items, onSelect }: { items: LeagueStartup[]; onSelect: (id: string) => void }) {
  const themes = THEMES.map((name) => ({
    name,
    rows: items.filter((row) => row.theme === name),
  })).filter((theme) => theme.rows.length);

  return (
    <div className="mt-10 space-y-12">
      {themes.map((theme) => (
        <section key={theme.name}>
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-xs uppercase tracking-[0.22em] text-primary">{theme.name}</h2>
            <p className="ml-auto text-xs tabular-nums text-white/30">{theme.rows.length}</p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-8">
            {theme.rows.map((startup) => (
              <Mark key={startup.id} startup={startup} active={false} onSelect={onSelect} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Orbits({ items, onSelect }: { items: LeagueStartup[]; onSelect: (id: string) => void }) {
  const themes = THEMES.map((name) => ({ name, rows: items.filter((row) => row.theme === name) })).filter((theme) => theme.rows.length);
  return (
    <div className="mt-8 grid gap-x-8 gap-y-12 lg:grid-cols-3">
      {themes.map((theme) => {
        const subs = [...new Set(theme.rows.map((row) => row.subtheme))];
        return (
          <section key={theme.name}>
            <p className="mb-1 text-center text-sm font-medium text-white">{theme.name}</p>
            <div className="relative mx-auto h-[400px] w-full max-w-[400px]">
              {PHASE_RADIUS.map((radius) => (
                <span key={radius} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" style={{ width: radius * 2, height: radius * 2 }} />
              ))}
              {theme.rows.map((startup) => {
                const sector = Math.max(0, subs.indexOf(startup.subtheme));
                const span = (Math.PI * 2) / Math.max(1, subs.length);
                const peers = theme.rows.filter((row) => row.subtheme === startup.subtheme && row.stage === startup.stage);
                const index = Math.max(0, peers.findIndex((row) => row.id === startup.id));
                const angle = sector * span - Math.PI / 2 + ((index + 0.5) / peers.length) * span * 0.82;
                const stageIndex = Math.max(0, STAGES.findIndex((item) => item.value === startup.stage));
                const radius = PHASE_RADIUS[stageIndex] ?? PHASE_RADIUS[0];
                return (
                  <div key={startup.id} className="absolute left-1/2 top-1/2" style={{ transform: `translate(calc(-50% + ${Math.cos(angle) * radius}px), calc(-50% + ${Math.sin(angle) * radius}px))` }}>
                    <Node startup={startup} onSelect={onSelect} />
                  </div>
                );
              })}
            </div>
            <p className="px-4 pb-4 text-center text-[10px] uppercase tracking-[0.16em] text-white/30">Inner idea · outer seed</p>
          </section>
        );
      })}
    </div>
  );
}

function Terrain({
  items,
  onPeak,
}: {
  items: LeagueStartup[];
  onPeak: (theme: string, stage: string) => void;
}) {
  const themes = THEMES.filter((name) => items.some((row) => row.theme === name));
  let max = 1;
  for (const name of themes) {
    for (const stageRow of STAGES) {
      const count = items.filter((row) => row.theme === name && row.stage === stageRow.value).length;
      if (count > max) max = count;
    }
  }

  return (
    <div className="mx-auto mt-14 max-w-4xl overflow-x-auto">
      <div className="mb-8 flex items-center gap-3 text-[13px] text-white/40">
        <span>Fewer</span>
        <span className="h-1.5 w-24 rounded-full bg-[linear-gradient(90deg,hsl(210_30%_12%),hsl(198_70%_32%),hsl(190_90%_58%))]" />
        <span>More</span>
      </div>
      <div className="grid min-w-[760px] gap-1.5" style={{ gridTemplateColumns: "11.5rem repeat(4, minmax(0, 1fr)) 4.5rem" }}>
        <div />
        {STAGES.map((item) => (
          <p key={item.value} className="pb-3 text-center text-[13px] font-normal text-white/40">
            {item.label}
          </p>
        ))}
        <p className="pb-3 text-center text-[13px] font-normal text-white/40">Total</p>
        {themes.map((name) => {
          const total = items.filter((row) => row.theme === name).length;
          return (
            <div key={name} className="contents">
              <p className="flex h-14 items-center justify-end pr-6 text-sm text-white/70">{name}</p>
              {STAGES.map((stageRow) => {
                const count = items.filter((row) => row.theme === name && row.stage === stageRow.value).length;
                const strength = count / max;
                return (
                  <button
                    key={stageRow.value}
                    type="button"
                    disabled={!count}
                    onClick={() => onPeak(name, stageRow.value)}
                    aria-label={`${name}, ${stageRow.label}, ${count}`}
                    className={cn("grid h-14 place-items-center text-lg font-medium tabular-nums", count ? "text-white hover:brightness-110" : "cursor-default")}
                    style={{
                      background: count
                        ? `hsl(${206 - strength * 16} ${38 + strength * 52}% ${9 + strength * 46}%)`
                        : "hsl(0 0% 6%)",
                    }}
                  >
                    {count || ""}
                  </button>
                );
              })}
              <p className="flex h-14 items-center justify-center text-sm tabular-nums text-white/75">{total}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SuperLeague = () => {
  const [rows, setRows] = useState<LeagueStartup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("list");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState("");
  const [stage, setStage] = useState("");
  const [revenue, setRevenue] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [peak, setPeak] = useState<{ theme: string; stage: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: loadError } = await supabase
        .from("super_league")
        .select("id, company_name, stage, theme, subtheme, advantage, founder_names, country, city, revenue, logo_url")
        .order("theme")
        .order("company_name");
      if (cancelled) return;
      if (loadError) {
        setError(loadError.message);
        setRows([]);
      } else {
        setRows((data || []) as LeagueStartup[]);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (theme && row.theme !== theme) return false;
      if (stage && row.stage !== stage) return false;
      if (revenue && row.revenue !== revenue) return false;
      if (!q) return true;
      return [row.company_name, row.subtheme, row.advantage, row.founder_names, row.city, row.country, row.theme]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, theme, stage, revenue]);

  const selected = filtered.find((row) => row.id === selectedId) || rows.find((row) => row.id === selectedId) || null;
  const peakItems = useMemo(
    () => (peak ? filtered.filter((row) => row.theme === peak.theme && row.stage === peak.stage) : []),
    [filtered, peak],
  );
  const generating = filtered.filter((row) => row.revenue === "generating").length;

  const select = (id: string) => {
    setSelectedId(id);
    setActionError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const back = () => {
    setSelectedId(null);
    setActionError(null);
  };

  const removeListing = async () => {
    if (!selected) return;
    setRemoving(true);
    const { data, error: deleteError } = await supabase.rpc("delete_super_league", { p_id: selected.id });
    setRemoving(false);
    const result = data as { ok?: boolean } | null;
    if (deleteError || !result?.ok) {
      setActionError(deleteError?.message || "Could not delete this listing. Apply the delete migration, then try again.");
      return;
    }
    setRows((current) => current.filter((row) => row.id !== selected.id));
    setSelectedId(null);
    setActionError(null);
  };

  return (
    <div className="pitch-theme min-h-screen bg-black font-pitch-display text-white">
      <div className="mx-auto max-w-7xl px-4 pb-20 pt-10 md:pt-14">
        <header className="flex items-end justify-between gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.22em] text-primary">Deal sourcing</p>
            <h1 className="mt-3 text-4xl font-medium tracking-tight md:text-5xl">Super League</h1>
            <p className="mt-3 max-w-xl text-sm text-white/45">
              A field of companies. Open a mark for the rest of the record.
            </p>
          </div>
          <button type="button" onClick={() => go("/")} className="text-sm text-white/50 hover:text-white">
            First Look
          </button>
        </header>

        <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-white/10 pb-4 text-sm">
          {VIEWS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setView(item.id);
                setPeak(null);
                setSelectedId(null);
              }}
              className={cn(view === item.id ? "text-white" : "text-white/35 hover:text-white/70")}
            >
              {item.label}
            </button>
          ))}
          <span className="ml-auto text-xs tabular-nums tracking-[0.14em] text-white/35">
            {filtered.length} companies · {generating} generating
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, city, advantage"
            className="border-b border-white/15 bg-transparent py-2 text-sm text-white placeholder:text-white/30 focus:border-primary focus:outline-none"
          />
          <select value={theme} onChange={(e) => setTheme(e.target.value)} className="border-b border-white/15 bg-transparent py-2 text-sm text-white focus:border-primary focus:outline-none">
            <option value="" className="bg-black">All themes</option>
            {THEMES.map((item) => (
              <option key={item} value={item} className="bg-black">{item}</option>
            ))}
          </select>
          <select value={stage} onChange={(e) => setStage(e.target.value)} className="border-b border-white/15 bg-transparent py-2 text-sm text-white focus:border-primary focus:outline-none">
            <option value="" className="bg-black">All phases</option>
            {STAGES.map((item) => (
              <option key={item.value} value={item.value} className="bg-black">{item.label}</option>
            ))}
          </select>
          <select value={revenue} onChange={(e) => setRevenue(e.target.value)} className="border-b border-white/15 bg-transparent py-2 text-sm text-white focus:border-primary focus:outline-none">
            <option value="" className="bg-black">Any revenue</option>
            <option value="pre_revenue" className="bg-black">Pre-revenue</option>
            <option value="generating" className="bg-black">Generating revenue</option>
          </select>
        </div>

        {selected ? (
          <div className="mt-10">
            <Detail startup={selected} removing={removing} onClose={back} onDelete={removeListing} />
            {actionError && <p className="mt-3 text-sm text-white/50">{actionError}</p>}
          </div>
        ) : (
          <>
            {loading && <p className="mt-16 text-sm text-white/40">Loading the league…</p>}
            {error && (
              <p className="mt-16 max-w-xl text-sm text-white/50">
                The league is not available yet. Apply the Super League migration, then reload.
              </p>
            )}
            {!loading && !error && !filtered.length && (
              <p className="mt-16 text-sm text-white/40">No companies in this cut yet.</p>
            )}
            {!loading && !error && filtered.length > 0 && view === "orbits" && (
              <Orbits items={filtered} onSelect={select} />
            )}
            {!loading && !error && filtered.length > 0 && view === "list" && (
              <ListView items={filtered} onSelect={select} />
            )}
            {!loading && !error && filtered.length > 0 && view === "terrain" && !peak && (
              <Terrain items={filtered} onPeak={(nextTheme, nextStage) => setPeak({ theme: nextTheme, stage: nextStage })} />
            )}
            {!loading && !error && view === "terrain" && peak && (
              <div className="mt-8">
                <button type="button" onClick={() => setPeak(null)} className="text-sm text-white hover:text-primary">
                  Back
                </button>
                <p className="mt-4 text-xs uppercase tracking-[0.22em] text-primary">
                  {peak.theme} · {stageLabel(peak.stage)}
                </p>
                <div className="mt-8 flex flex-wrap gap-x-6 gap-y-8">
                  {peakItems.map((startup) => (
                    <Mark key={startup.id} startup={startup} active={false} onSelect={select} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default SuperLeague;
