// 统计与筛选：四项统计指标、阶段筛选。

export function computeStats(state) {
  const repairs = state.repairs;
  return {
    waiting: repairs.filter((r) => r.stage === "intake" || r.stage === "rejected").length,
    scheduled: repairs.filter((r) => ["scheduled", "work"].includes(r.stage)).length,
    rectifying: repairs.filter((r) => r.stage === "rectify").length,
    committedCost: repairs
      .filter((r) => r.stage !== "done")
      .reduce((sum, r) => sum + Number(r.estimatedCost || 0), 0)
  };
}

export function filteredRepairs(state) {
  const repairs = [...state.repairs].sort((a, b) => b.createdAt - a.createdAt);
  if (state.filter === "all") return repairs;
  return repairs.filter((repair) => repair.stage === state.filter);
}
