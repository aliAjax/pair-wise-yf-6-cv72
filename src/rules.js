// 规则流转层：三前置放行、预约排期（技能 / 两小时时段 / 同址合并）、
// 开工前检查与整改释放、完工登记与验收退回、统计。
// 所有状态变更都通过 appendEvent 追加历史，历史不覆盖、不删除。

import {
  GATES,
  SLOTS,
  FINDINGS,
  COMPLETION_REASONS,
  SKILLS,
  createItem,
  nowISO
} from "./model.js";

const ACTIVE_VISIT_STATUS = ["scheduled", "halted", "active"];

function appendEvent(state, type, itemIds, text, at = nowISO()) {
  const event = { id: crypto.randomUUID(), type, itemIds: [...itemIds], text, at };
  state.events.push(event);
  return event;
}

export function itemById(state, id) {
  return state.items.find((item) => item.id === id);
}

export function visitById(state, id) {
  return state.visits.find((visit) => id && visit.id === id);
}

export function technicianById(state, id) {
  return state.technicians.find((tech) => tech.id === id);
}

export function visitRectifications(state, visitId) {
  return state.rectifications.filter((rect) => rect.visitId === visitId);
}

export function itemEvents(state, itemId) {
  return state.events
    .filter((event) => event.itemIds.includes(itemId))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export function gateInfo(item) {
  const completed = GATES.filter((gate) => item.gates[gate.key].done);
  const missing = GATES.filter((gate) => !item.gates[gate.key].done);
  return {
    completed,
    missing,
    allDone: missing.length === 0,
    next: missing[0] || null
  };
}

export function addItem(state, input) {
  const item = createItem(input);
  state.items.unshift(item);
  appendEvent(state, "created", [item.id], `登记维修事项：${item.address} ${item.location} ${item.title}`);
  return item;
}

// 三道前置按 测量 → 备料 → 业主确认 的顺序完成；已有约次的事项闸门锁定。
export function completeGate(state, itemId, gateKey) {
  const item = itemById(state, itemId);
  if (!item || item.status !== "pending" || item.gates[gateKey].done) return { ok: false };
  const next = gateInfo(item).next;
  if (!next || next.key !== gateKey) return { ok: false };

  item.gates[gateKey] = { done: true, at: nowISO() };
  const label = GATES.find((gate) => gate.key === gateKey).label;
  appendEvent(state, "gate", [item.id], `前置完成：${label}`);
  if (gateInfo(item).allDone) {
    appendEvent(state, "gate_ready", [item.id], "三道前置全部完成，可预约上门");
  }
  return { ok: true };
}

// 可参与排期：未挂约次且三道前置全部完成。
export function schedulableItems(state) {
  return state.items.filter((item) => item.status === "pending" && gateInfo(item).allDone);
}

// 同址合并候选：与触发事项同地址、前置齐备、尚未排期的全部事项。
function mergeGroup(state, item) {
  return schedulableItems(state).filter((other) => other.address.trim() === item.address.trim());
}

// 候选技师：覆盖整组全部技能，按固定候选顺序排列。
function candidatesFor(state, skillSet) {
  return state.technicians
    .filter((tech) => [...skillSet].every((skill) => tech.skills.includes(skill)))
    .sort((a, b) => a.order - b.order);
}

function slotBusy(state, technicianId, date, slot) {
  return state.visits.some(
    (visit) =>
      visit.technicianId === technicianId &&
      visit.date === date &&
      visit.slot === slot &&
      ACTIVE_VISIT_STATUS.includes(visit.status)
  );
}

function visitCode(state, date) {
  state.seq.visit += 1;
  const monthDay = date.slice(5).replace("-", "");
  return `V${monthDay}-${String(state.seq.visit).padStart(2, "0")}`;
}

// 预约：按 技师技能 → 当日两小时时段占用 → 同址合并 成组判定；
// 任一候选在该时段都冲突时整次拒绝，原排期不变，候选顺序保留。
export function attemptBooking(state, { itemId, date, slot }) {
  const item = itemById(state, itemId);
  if (!item) return { ok: false, message: "事项不存在" };
  if (item.status !== "pending" || item.visitId) {
    return { ok: false, message: "该事项已挂约次，不能重复预约" };
  }
  if (!gateInfo(item).allDone) {
    return { ok: false, message: "三道前置未全部完成，不得预约上门" };
  }
  if (!SLOTS.includes(slot)) return { ok: false, message: "时段无效" };

  const group = mergeGroup(state, item);
  const skillSet = new Set(group.map((member) => member.skill));
  const candidates = candidatesFor(state, skillSet);
  const addressLabel = item.address;
  const skillLabel = [...skillSet].map((skill) => SKILLS[skill]).join("、");
  const candidateNames = candidates.map((tech) => tech.name);

  if (!candidates.length) {
    return {
      ok: false,
      message: `无技师同时覆盖技能（${skillLabel}），无法排期`
    };
  }

  const technician = candidates.find((tech) => !slotBusy(state, tech.id, date, slot));

  // 整次拒绝：同址整组不拆分，任何候选都冲突则全部不排，原排期不变。
  if (!technician) {
    item.rejection = {
      date,
      slot,
      groupIds: group.map((member) => member.id),
      candidateNames,
      at: nowISO()
    };
    appendEvent(
      state,
      "booking_rejected",
      group.map((member) => member.id),
      `整次拒绝：${date} ${slot} ${addressLabel}（${group
        .map((member) => member.location)
        .join("、")}，${group.length} 项合并）；候选顺序 ${candidateNames.join(
        " → "
      )} 均有时段冲突，原排期不变，候选顺序保留`
    );
    return {
      ok: false,
      message: `整次拒绝：候选顺序 ${candidateNames.join(" → ")} 在 ${date} ${slot} 均被占用；同址 ${group.length} 项整组不拆，原排期不变，候选顺序保留。`
    };
  }

  const visit = {
    id: crypto.randomUUID(),
    code: visitCode(state, date),
    technicianId: technician.id,
    date,
    slot,
    itemIds: group.map((member) => member.id),
    status: "scheduled",
    createdAt: nowISO()
  };
  state.visits.push(visit);

  group.forEach((member) => {
    member.status = "scheduled";
    member.visitId = visit.id;
    member.rejection = null;
  });

  appendEvent(
    state,
    "scheduled",
    visit.itemIds,
    `排期成功：约 ${visit.code} ${technician.name} ${date} ${slot}；${addressLabel} 同址合并 ${group.length} 项（${group
      .map((member) => member.location)
      .join("、")}），候选顺序 ${candidateNames.join(" → ")}，命中 ${technician.name}`
  );

  return { ok: true, visit, group };
}

// 开工前检查：无异常准予开工；发现断电 / 擅自扩项 / 安全条件不符任一，
// 立即停止，逐项生成整改项，原约冻结（日期时段不变）。
export function attemptInspection(state, { visitId, findings, note }) {
  const visit = visitById(state, visitId);
  if (!visit || visit.status !== "scheduled") {
    return { ok: false, message: "当前约次不在待开工状态" };
  }
  const picked = (findings || []).filter((key) => Object.hasOwn(FINDINGS, key));

  if (!picked.length) {
    visit.status = "active";
    visit.itemIds.forEach((id) => {
      itemById(state, id).status = "doing";
    });
    appendEvent(
      state,
      "inspection_passed",
      visit.itemIds,
      `开工前检查通过（约 ${visit.code}），准予开工${note ? `：${note}` : ""}`
    );
    return { ok: true, passed: true };
  }

  visit.status = "halted";
  visit.itemIds.forEach((id) => {
    itemById(state, id).status = "halted";
  });

  picked.forEach((reason) => {
    state.rectifications.push({
      id: crypto.randomUUID(),
      visitId: visit.id,
      reason,
      detail: note && picked.length === 1 ? note : "",
      status: "open",
      createdAt: nowISO(),
      recheckedAt: null
    });
  });

  appendEvent(
    state,
    "inspection_failed",
    visit.itemIds,
    `开工前检查发现 ${picked
      .map((key) => FINDINGS[key])
      .join("、")}（约 ${visit.code}），立即停止；已生成 ${picked.length} 项整改，原约 ${visit.date} ${visit.slot} 冻结不变${
      note ? `；说明：${note}` : ""
    }`
  );
  return { ok: true, passed: false, reasons: picked };
}

// 整改复检：单项通过后关闭；同约全部整改通过才释放原约。
export function recheckRectification(state, rectificationId) {
  const rect = state.rectifications.find((item) => item.id === rectificationId);
  if (!rect || rect.status !== "open") return { ok: false, message: "整改项不可复检" };
  const visit = visitById(state, rect.visitId);
  if (!visit || visit.status !== "halted") return { ok: false, message: "原约不在停工状态" };

  rect.status = "passed";
  rect.recheckedAt = nowISO();
  appendEvent(state, "recheck", visit.itemIds, `整改复检通过：${FINDINGS[rect.reason]}`);

  const open = visitRectifications(state, visit.id).filter((item) => item.status === "open");
  if (!open.length) {
    visit.status = "scheduled";
    visit.itemIds.forEach((id) => {
      itemById(state, id).status = "scheduled";
    });
    appendEvent(
      state,
      "released",
      visit.itemIds,
      `全部整改复检通过，原约释放：${visit.code} ${visit.date} ${visit.slot} 排期不变，可重新开工前检查`
    );
  }
  return { ok: true, released: open.length === 0 };
}

// 完工登记：实际费用 + 业主验收；费用超承诺两成或验收退回，均退回处理中。
// 登记记录只追加，验收结论与状态不改写历史。
export function registerCompletion(state, { itemId, actualCost, acceptance, note }) {
  const item = itemById(state, itemId);
  if (!item || item.status !== "doing") return { ok: false, message: "仅处理中事项可登记完工" };

  const cost = Number(actualCost);
  if (!Number.isFinite(cost) || cost < 0) return { ok: false, message: "实际费用无效" };
  if (!["passed", "rejected"].includes(acceptance)) return { ok: false, message: "请选择业主验收结论" };

  const cap = Math.round(item.estimatedCost * 1.2 * 100) / 100;
  const reasons = [];
  if (cost > cap) reasons.push("overrun");
  if (acceptance === "rejected") reasons.push("rejected");
  const result = reasons.length ? "returned" : "done";

  const record = {
    id: crypto.randomUUID(),
    at: nowISO(),
    actualCost: cost,
    acceptance,
    result,
    reasons,
    note: String(note || "").trim()
  };
  item.completions.push(record);

  const acceptanceText = acceptance === "passed" ? "业主验收通过" : "业主验收退回";

  if (result === "done") {
    item.status = "done";
    const visit = visitById(state, item.visitId);
    let visitClosed = false;
    if (visit) {
      visitClosed = visit.itemIds.every((id) => itemById(state, id).status === "done");
      if (visitClosed) visit.status = "done";
    }
    appendEvent(
      state,
      "completion_done",
      [item.id],
      `完工登记：实际 ¥${cost}，${acceptanceText} → 验收结案${
        visit && visitClosed ? `；同约事项全部完成，约 ${visit.code} 关闭` : ""
      }`
    );
    return { ok: true, result };
  }

  const reasonText = reasons
    .map((key) =>
      key === "overrun"
        ? `实际费用超承诺两成（承诺 ¥${item.estimatedCost}，上限 ¥${cap}）`
        : COMPLETION_REASONS[key]
    )
    .join("、");
  appendEvent(
    state,
    "completion_returned",
    [item.id],
    `完工登记：实际 ¥${cost}，${acceptanceText} → 退回处理中：${reasonText}；登记保留待后续处理${
      note ? `；说明：${note}` : ""
    }`
  );
  return { ok: true, result, reasons };
}

export function filteredItems(state) {
  if (state.filter === "all") return state.items;
  return state.items.filter((item) => item.status === state.filter);
}

export function computeStats(state) {
  const scheduledCount = state.items.filter((item) => item.status === "scheduled").length;
  return [
    { key: "pending", label: "待放行", value: state.items.filter((item) => item.status === "pending").length, hint: "三道前置未齐 / 可预约" },
    { key: "scheduled", label: "已排期待开工", value: scheduledCount, hint: "等待上门检查" },
    { key: "halted", label: "停工整改", value: state.items.filter((item) => item.status === "halted").length, hint: "复检通过才释放原约" },
    { key: "done", label: "已验收", value: state.items.filter((item) => item.status === "done").length, hint: "实际费用与验收通过" }
  ];
}
