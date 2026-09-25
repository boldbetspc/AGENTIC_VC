export const THEMES = [
  "AI Frontier",
  "Applied AI",
  "Fintech",
  "Mobility",
  "CleanTech",
  "Climate & Energy",
  "Legal",
  "Health",
  "Biotech",
  "Enterprise Software",
  "Developer Tools",
  "Cybersecurity",
  "Consumer",
  "Marketplaces",
  "Commerce",
  "Proptech",
  "Edtech",
  "Food & Agriculture",
  "Industrial & Deep Tech",
  "Defense & Space",
] as const;

export const STAGES = [
  { value: "Idea", label: "Idea" },
  { value: "WorkingPrototype", label: "Working prototype" },
  { value: "PreSeed", label: "Pre-seed" },
  { value: "Seed", label: "Seed" },
] as const;

export function stageLabel(value: string) {
  return STAGES.find((s) => s.value === value)?.label || value;
}

export function companyKey(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
