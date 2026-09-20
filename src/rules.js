// 规则流转层：三道前置放行、技师/时段/同址合并排期、开工检查停止、整改释放、完工退回。
// 只读取/变更数据，不触碰 DOM。

import {
  SLOTS,
  PRIORITY_ORDER,
  appendHistory,
  createRectification,
  uid,
  dateKey
} from "./model.js";

// ---------- 前置三道：测量 / 备料 / 业主确认 ----------

export function missingGates(repair) {
  return Object.entries(repair.gates)
    .filter(([, done]) => !done)
    .map(([key]) => key);
}

export function gatesReady(repair) {
  return missingGates(repair).length === 0;
}

// 切换某道前置的完成状态；全部齐备时进入可约，不齐时退回前置未齐
export function setGate(state, repairId, gate, done) {
  const repair = state.repairs.find((r) => r.id === repairId);
  if (!repair) return;
  const label = { measure: "测量", material: "备料", ownerConfirm: "业主确认" }[gate];
  repair.gates[gate] = done;
  appendHistory(repair, `${label}${done ? "完成" : "撤销"}`);

  // 已放行的事项不允许被前置变更直接改状态（叫停由开工检查负责）
  if (["intake", "ready", "rejected"].includes(repair.stage)) {
    if (gatesReady(repair)) {
      repair.stage = "ready";
      appendHistory(repair, "前置齐备", "进入可约上门");
    } else if (repair.stage !== "intake") {
      repair.stage = "intake";
      appendHistory(repair, "前置不齐", "退回前置未齐，原排期不变");
    }
  }
  setNotice(state, done ? `${label}已完成` : `${label}已撤销`);
}

// 卡点说明：显示在事项旁边
export function blockReason(repair) {
  const missing = missingGates(repair);
  if (missing.length) {
    const names = missing.map((key) => ({ measure: "测量", material: "备料", ownerConfirm: "业主确认" }[key]));
    return `卡点：${names.join("、")}未完成，暂不能预约上门`;
  }
  if (repair.stage === "rejected") return "卡点：上一轮排期整次被拒绝，候选顺序已保留，可重新尝试";
  if (repair.stage === "rectify") return "卡点：开工检查不通过，整改复检通过前不得继续施工";
  if (repair.stage === "accepted") return "卡点：验收退回，返工后需重新登记完工";
  if (repair.stage === "overrun") return "卡点：实际费用超承诺两成，转退回处理中";
  return "";
}

// ---------- 排期：技能 × 两小时时段 × 同址合并，冲突整次拒绝 ----------

export function dispatchableRepairs(state) {
  return state.repairs
    .filter((r) => (r.stage === "ready" || r.stage === "rejected") && !r.visitId)
    .sort(repairSort);
}

function repairSort(a, b) {
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.createdAt - b.createdAt;
}

// 同址合并：同地址的可约事项并为一组，必须由覆盖全部技能的同一技师在同一时段承接
function buildGroups(state, onlyRepairId = null) {
  let items = dispatchableRepairs(state);
  if (onlyRepairId) items = items.filter((r) => r.id === onlyRepairId);
  const byAddress = new Map();
  for (const repair of items) {
    if (!byAddress.has(repair.address)) byAddress.set(repair.address, []);
    byAddress.get(repair.address).push(repair);
  }
  return [...byAddress.entries()]
    .map(([address, members]) => ({
      address,
      members: members.sort(repairSort),
      skills: [...new Set(members.map((m) => m.skill))]
    }))
    .sort(
      (a, b) =>
        repairSort(a.members[0], b.members[0]) ||
        b.members.length - a.members.length ||
        a.address.localeCompare(b.address, "zh")
    );
}

function technicianCanCover(technician, requiredSkills) {
  if (!technician.active) return false;
  if (technician.skills.includes("general")) return true;
  return requiredSkills.every((skill) => technician.skills.includes(skill));
}

// 某日某时段技师是否被占用：已有上门、被停止待整改的上门、或外部 blockout
function slotOccupied(state, technicianId, date, slot) {
  const technician = state.technicians.find((t) => t.id === technicianId);
  if (technician && (technician.blockouts[date] || []).includes(slot)) {
    return { conflict: true, reason: "外部占用" };
  }
  const visit = state.visits.find(
    (v) =>
      v.technicianId === technicianId &&
      v.date === date &&
      v.slot === slot &&
      v.status !== "done"
  );
  if (visit) return { conflict: true, reason: `已排 ${visit.address}` };
  return { conflict: false };
}

// 候选顺序：综合技师靠后（优先用专科技师），其次当日已排次数少者，再次姓名
function candidateTechnicians(state, group, date) {
  return state.technicians
    .filter((t) => technicianCanCover(t, group.skills))
    .map((t) => ({
      technician: t,
      load: state.visits.filter((v) => v.technicianId === t.id && v.date === date && v.status !== "done")
        .length
    }))
    .sort(
      (a, b) =>
        Number(a.technician.skills.includes("general")) - Number(b.technician.skills.includes("general")) ||
        a.load - b.load ||
        a.technician.name.localeCompare(b.technician.name, "zh")
    )
    .map((entry) => entry.technician);
}

// 单组按候选顺序枚举（技师, 时段），第一个无冲突方案即采纳
function solveGroup(state, group, date, occupiedPlan) {
  const candidates = [];
  for (const technician of candidateTechnicians(state, group, date)) {
    for (const slot of SLOTS) {
      const key = `${technician.id}|${slot}`;
      const blocked = occupiedPlan.has(key);
      const existing = blocked ? { conflict: true, reason: occupiedPlan.get(key) } : slotOccupied(state, technician.id, date, slot);
      const option = {
        technicianId: technician.id,
        technicianName: technician.name,
        slot,
        conflict: existing.conflict,
        reason: existing.reason || ""
      };
      candidates.push(option);
      if (!existing.conflict) {
        occupiedPlan.set(key, `已排 ${group.address}`);
        return { option, candidates };
      }
    }
  }
  return { option: null, candidates };
}

// 统一排期入口：冲突时任一组失败 → 整次拒绝，候选顺序原样保留
export function attemptDispatch(state, { date = null, repairId = null } = {}) {
  const targetDate = date || state.dispatchDate || dateKey(0);
  const groups = buildGroups(state, repairId);
  if (!groups.length) {
    return setNotice(state, "当前没有三道前置齐备且可预约的事项");
  }

  const occupiedPlan = new Map(); // 本轮内占位，保证组间也不互撞
  const groupResults = groups.map((group) => {
    const result = solveGroup(state, group, targetDate, occupiedPlan);
    return { group, ...result };
  });

  const failed = groupResults.find((result) => !result.option);
  const attempt = {
    id: uid(),
    at: Date.now(),
    date: targetDate,
    scope: repairId ? "single" : "all",
    success: !failed,
    groups: groupResults.map((result) => ({
      address: result.group.address,
      memberIds: result.group.members.map((m) => m.id),
      skills: result.group.skills,
      chosen: result.option
        ? { technicianId: result.option.technicianId, technicianName: result.option.technicianName, slot: result.option.slot }
        : null,
      candidates: result.candidates
    }))
  };

  if (failed) {
    // 整次拒绝：不产生任何排期，原排期不变，事项标 rejected 并保留候选顺序
    for (const result of groupResults) {
      for (const member of result.group.members) {
        if (member.stage === "ready") {
          member.stage = "rejected";
          appendHistory(member, "排期整次拒绝", `${targetDate} 无可执行方案，候选顺序已保留`);
        }
      }
    }
    state.attempts.unshift(attempt);
    trimAttempts(state);
    return setNotice(state, `排期整次拒绝：${failed.group.address} 无可用技师/时段，候选顺序已保留`);
  }

  // 整次提交
  for (const result of groupResults) {
    const { option } = result;
    const memberIds = result.group.members.map((m) => m.id);
    const visit = {
      id: uid(),
      address: result.group.address,
      date: targetDate,
      slot: option.slot,
      technicianId: option.technicianId,
      status: "scheduled",
      memberIds,
      history: []
    };
    appendHistory(
      visit,
      "系统排期",
      `${targetDate} ${option.slot} · ${option.technicianName} · 合并 ${memberIds.length} 项`
    );
    state.visits.push(visit);
    for (const member of result.group.members) {
      member.visitId = visit.id;
      member.stage = "scheduled";
      appendHistory(
        member,
        "排期通过",
        `${targetDate} ${option.slot} · ${option.technicianName}${
          memberIds.length > 1 ? "（同址合并）" : ""
        }`
      );
    }
  }
  state.attempts.unshift(attempt);
  trimAttempts(state);
  return setNotice(state, `排期成功：${targetDate} 共安排 ${groupResults.length} 组上门`);
}

function trimAttempts(state) {
  if (state.attempts.length > 10) state.attempts.length = 10;
}

// ---------- 开工前检查：断电 / 擅自扩项 / 安全条件不符 ----------

export function preStartCheck(state, visitId, findings, extraDetail = "") {
  const visit = state.visits.find((v) => v.id === visitId);
  if (!visit || !["scheduled", "released"].includes(visit.status)) return;
  const hit = findings.filter((key) => key && key !== "ok");

  if (!hit.length) {
    visit.status = "released";
    appendHistory(visit, "开工检查通过", "释放原约，开始施工");
    for (const repair of memberRepairs(state, visit)) {
      repair.stage = "work";
      appendHistory(repair, "开工检查通过", "开始施工");
    }
    return setNotice(state, "开工检查通过，已放行施工");
  }

  // 立即停止：整次上门叫停，逐项生成整改项，原约冻结
  visit.status = "halted";
  const labels = hit.map((key) => ({ power: "断电", scope: "擅自扩项", safety: "安全条件不符" }[key]));
  appendHistory(visit, "开工检查停止", labels.join("、"));
  for (const repair of memberRepairs(state, visit)) {
    repair.stage = "rectify";
    appendHistory(repair, "开工检查停止", labels.join("、"));
    for (const reason of hit) {
      const rect = createRectification({ repairId: repair.id, visitId: visit.id, reason, detail: extraDetail });
      appendHistory(rect, "生成整改项", labels.join("、"));
      state.rectifications.push(rect);
    }
  }
  return setNotice(state, `立即停止：${labels.join("、")}，已生成整改项`);
}

export function openRectifications(state, visitId) {
  return state.rectifications.filter((r) => r.visitId === visitId && r.status === "open");
}

// 整改复检：全部整改项通过才释放原约
export function recheckRectification(state, rectificationId, passed) {
  const rect = state.rectifications.find((r) => r.id === rectificationId);
  if (!rect || rect.status !== "open") return;
  if (!passed) {
    appendHistory(rect, "复检未通过", "整改项保持开启");
    return setNotice(state, "复检未通过，整改项继续挂起");
  }
  rect.status = "passed";
  rect.closedAt = new Date().toISOString().slice(0, 16).replace("T", " ");
  appendHistory(rect, "复检通过", "释放原约");
  const repair = state.repairs.find((r) => r.id === rect.repairId);
  if (repair) appendHistory(repair, "整改复检通过", "整改项关闭");

  const visit = state.visits.find((v) => v.id === rect.visitId);
  if (visit && openRectifications(state, visit.id).length === 0) {
    visit.status = "released";
    appendHistory(visit, "整改完成释放原约", `${visit.date} ${visit.slot}`);
    for (const member of memberRepairs(state, visit)) {
      member.stage = "scheduled";
      appendHistory(member, "释放原约", "等待重新开工检查");
    }
    return setNotice(state, "全部整改复检通过，原约已释放");
  }
  return setNotice(state, "该整改项复检通过，仍有其他整改项待复检");
}

// ---------- 完工登记：实际费用 + 业主验收 ----------

export function registerCompletion(state, repairId, actualCostValue, acceptance, feedback = "") {
  const repair = state.repairs.find((r) => r.id === repairId);
  if (!repair) return;
  const actualCost = Number(actualCostValue || 0);
  repair.actualCost = actualCost;
  appendHistory(repair, "完工登记", `实际费用 ¥${actualCost}${feedback ? `；${feedback}` : ""}`);

  // 费用超承诺两成：无论验收结论如何，转退回处理中
  const overLimit = repair.estimatedCost * 1.2;
  if (actualCost > overLimit + 1e-9) {
    repair.stage = "overrun";
    repair.acceptance = acceptance;
    appendHistory(
      repair,
      "费用超承诺",
      `实际 ¥${actualCost} 超承诺 ¥${repair.estimatedCost} 的两成（上限 ¥${overLimit.toFixed(0)}），转退回处理中`
    );
    return setNotice(state, "实际费用超承诺两成，已转退回处理中");
  }

  if (acceptance === "return") {
    repair.stage = "accepted";
    repair.acceptance = "return";
    appendHistory(repair, "业主验收", `验收退回${feedback ? `：${feedback}` : ""}`);
    return setNotice(state, "验收退回，事项转处理中");
  }

  repair.stage = "done";
  repair.acceptance = "pass";
  appendHistory(repair, "业主验收", "验收通过");
  const visit = state.visits.find((v) => v.id === repair.visitId);
  if (visit && memberRepairs(state, visit).every((m) => m.stage === "done")) {
    visit.status = "done";
    appendHistory(visit, "上门完工", "合并事项全部验收通过");
  }
  return setNotice(state, "完工登记成功，业主验收通过");
}

// 验收退回后返工，重新回到施工中（历史保留，可再次登记完工）
export function resumeRework(state, repairId) {
  const repair = state.repairs.find((r) => r.id === repairId);
  if (!repair || !["accepted", "overrun"].includes(repair.stage)) return;
  repair.stage = "work";
  appendHistory(repair, "返工继续", "退回处理完成，重新进入施工");
  return setNotice(state, "已恢复施工，可再次登记完工");
}

// ---------- 查询辅助 ----------

export function memberRepairs(state, visit) {
  return visit.memberIds
    .map((id) => state.repairs.find((r) => r.id === id))
    .filter(Boolean);
}

export function technicianName(state, technicianId) {
  const technician = state.technicians.find((t) => t.id === technicianId);
  return technician ? technician.name : "未指派";
}

export function visitById(state, visitId) {
  return state.visits.find((v) => v.id === visitId);
}

function setNotice(state, message) {
  state.notice = { message, at: Date.now() };
  return state.notice;
}
