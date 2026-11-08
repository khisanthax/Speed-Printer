import type { Bundle, Profile } from "./domain";
export type Choice = {
  id: string;
  name: string;
  source: string;
  compatibility: string;
};
export type Printer = {
  id: string;
  name: string;
  source: string;
  current: boolean;
  remembered: boolean;
  process: Choice[];
  filament: Choice[];
  selected: { process: string; filament: string };
};
export type Library = {
  imported: boolean;
  profiles: Profile[];
  printers: Printer[];
  warnings?: string[];
  note?: string;
  stale?: boolean;
};
export function sourceStatus(bundle: Bundle, library?: Library) {
  if (!library?.imported) return "";
  const messages = Object.values(bundle).flatMap((p) => {
    if (!p.__sp_id) return [];
    const live = library.profiles.find((q) => q.__sp_id === p.__sp_id);
    return !live
      ? [`${p.type} source missing / renamed; snapshot retained`]
      : live.__sp_hash !== p.__sp_hash
        ? [`${p.type} source changed; snapshot retained`]
        : [];
  });
  return messages.join(" · ");
}
export function bundleFor(
  library: Library,
  printer: Printer,
  picks = printer.selected,
): Bundle | undefined {
  const result = {
    machine: library.profiles.find((p) => p.__sp_id === printer.id),
    process: library.profiles.find((p) => p.__sp_id === picks.process),
    filament: library.profiles.find((p) => p.__sp_id === picks.filament),
  };
  return result.machine && result.process && result.filament
    ? (structuredClone(result) as Bundle)
    : undefined;
}
