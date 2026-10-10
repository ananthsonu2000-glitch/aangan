export type Strategy = "round_robin" | "least_loaded";
export type Assignable = { id: string; name: string; active: boolean; sortOrder: number; lastAssignedAt: Date | null };

/** Role for a given lead status. Qualified -> designers, everything else -> front desk. */
export function roleForStatus(status: "qualified" | "needs_recheck"): "designer" | "front_desk" {
  return status === "qualified" ? "designer" : "front_desk";
}

/**
 * Pure picker. round_robin: the active person who was assigned longest ago (never-assigned first, then sortOrder).
 * least_loaded: fewest open leads, ties broken by round-robin order.
 */
export function pickAssignee<T extends Assignable>(pool: T[], strategy: Strategy = "round_robin", openCounts: Record<string, number> = {}): T | null {
  const active = pool.filter((e) => e.active);
  if (!active.length) return null;
  const rr = (a: T, b: T) => {
    const ta = a.lastAssignedAt?.getTime() ?? -Infinity;
    const tb = b.lastAssignedAt?.getTime() ?? -Infinity;
    return ta - tb || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  };
  const sorted = [...active].sort(strategy === "least_loaded" ? (a, b) => (openCounts[a.id] ?? 0) - (openCounts[b.id] ?? 0) || rr(a, b) : rr);
  return sorted[0];
}
