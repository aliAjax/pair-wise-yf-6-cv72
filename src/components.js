// 页面组件层：只负责按当前状态产出 HTML 字符串，所有交互通过 data-action 交由 main.js 委托处理。

import {
  stages,
  stageFilters,
  priorities,
  skills,
  gates,
  gateChecks,
  acceptanceResults
} from "./model.js";
import {
  missingGates,
  gatesReady,
  blockReason,
  dispatchableRepairs,
  memberRepairs,
  technicianName,
  openRectifications
} from "./rules.js";
import { computeStats, filteredRepairs } from "./stats.js";

export function renderApp(state) {
  const stats = computeStats(state);
  const dispatchable = dispatchableRepairs(state);

  return `
    <main class="shell">
      ${renderHeader(stats)}
      ${state.notice ? `<div class="notice" data-action="dismiss-notice">${escapeHtml(state.notice.message)}<button type="button" class="notice-x">×</button></div>` : ""}
      <section class="layout">
        <aside class="side">
          ${renderCreatePanel()}
          ${renderDispatchPanel(state, dispatchable)}
        </aside>
        <section class="main-col">
          ${renderToolbar(state)}
          <div class="repairs">${renderRepairList(state)}</div>
        </section>
      </section>
    </main>
  `;
}

function renderHeader(stats) {
  return `
    <header class="header">
      <div>
        <p class="eyebrow">本地数据 · 刷新保留</p>
        <h1>上门施工放行台</h1>
        <p class="subtitle">测量 · 备料 · 业主确认三道前置齐备方可预约；开工检查不通过即停整整改。</p>
      </div>
      <section class="stats">
        <div class="stat"><span>待前置放行</span><strong>${stats.waiting}</strong></div>
        <div class="stat"><span>已排/施工中</span><strong>${stats.scheduled}</strong></div>
        <div class="stat"><span>整改中</span><strong>${stats.rectifying}</strong></div>
        <div class="stat"><span>承诺费用合计</span><strong>¥${stats.committedCost}</strong></div>
      </section>
    </header>
  `;
}

function renderCreatePanel() {
  return `
    <section class="panel">
      <h2>登记维修维护事项</h2>
      <form class="form" data-form="create">
        <label>住址（同址合并依据）<input name="address" required placeholder="例如本宅302" value="本宅302"></label>
        <label>位置<input name="location" required placeholder="例如卫生间"></label>
        <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
        <div class="two-col">
          <label>优先级
            <select name="priority">
              ${Object.entries(priorities).map(([v, l]) => `<option value="${v}" ${v === "medium" ? "selected" : ""}>${l}</option>`).join("")}
            </select>
          </label>
          <label>工种
            <select name="skill">
              ${Object.entries(skills).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}
            </select>
          </label>
        </div>
        <label>承诺费用（元）<input name="estimatedCost" type="number" min="0" step="1" value="0"></label>
        <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
        <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
        <button class="primary" type="submit">登记事项</button>
      </form>
    </section>
  `;
}

function renderDispatchPanel(state, dispatchable) {
  const latest = state.attempts[0];
  const blocked = state.repairs.filter((r) => !r.visitId && !gatesReady(r)).length;
  return `
    <section class="panel dispatch">
      <h2>上门排期放行</h2>
      <p class="hint">按技师技能、当日两小时时段、同址合并统一安排；任一冲突整次拒绝，候选顺序保留。</p>
      <label>排期日期
        <input type="date" data-action="dispatch-date" value="${escapeHtml(state.dispatchDate)}">
      </label>
      <div class="dispatch-meta">
        <span>当日可约事项 <strong>${dispatchable.length}</strong> 项</span>
        <span>可合并住址 <strong>${new Set(dispatchable.map((r) => r.address)).size}</strong> 个</span>
      </div>
      ${blocked ? `<p class="hint warn">另有 ${blocked} 项前置未齐不参与排期，原排期不变。</p>` : ""}
      <div class="actions">
        <button class="primary" type="button" data-action="dispatch-all">统一安排全部可约事项</button>
      </div>
      ${latest ? renderAttempt(latest) : `<p class="hint">尚无排期尝试。</p>`}
    </section>
  `;
}

function renderAttempt(attempt) {
  return `
    <div class="attempt ${attempt.success ? "ok" : "fail"}">
      <div class="attempt-head">
        <strong>${attempt.success ? "最近一次：排期成功" : "最近一次：整次拒绝"}</strong>
        <span>${escapeHtml(attempt.date)} · ${attempt.scope === "single" ? "单项" : "全部"}</span>
      </div>
      ${attempt.groups
        .map((group) => {
          const chosen = group.chosen
            ? `<span class="chip ok">${escapeHtml(chosen.technicianName)} · ${escapeHtml(chosen.slot)}</span>`
            : `<span class="chip danger">无可用方案</span>`;
          return `
            <div class="attempt-group">
              <div class="row"><strong>${escapeHtml(group.address)}</strong>${chosen}<span class="chip">${group.memberIds.length} 项</span></div>
              <ol class="candidates">
                ${group.candidates
                  .slice(0, 6)
                  .map(
                    (c) => `<li class="${c.conflict ? "conflict" : "free"}">${escapeHtml(c.technicianName)} · ${escapeHtml(c.slot)}${
                      c.conflict ? ` — ${escapeHtml(c.reason)}` : " — 可排"
                    }</li>`
                  )
                  .join("")}
              </ol>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderToolbar(state) {
  return `
    <div class="toolbar">
      ${Object.entries(stageFilters)
        .map(
          ([value, label]) =>
            `<button type="button" class="seg ${state.filter === value ? "active" : ""}" data-action="filter" data-filter="${value}">${label}</button>`
        )
        .join("")}
    </div>
  `;
}

function renderRepairList(state) {
  const visible = filteredRepairs(state);
  if (!visible.length) return `<div class="empty">当前筛选下没有事项</div>`;

  // 同一上门的事项：首卡渲染上门控制区，其余卡只显示合并提示
  const renderedVisitSections = new Set();
  return visible
    .map((repair) => {
      let visitHtml = "";
      const visit = repair.visitId ? state.visits.find((v) => v.id === repair.visitId) : null;
      if (visit && !renderedVisitSections.has(visit.id)) {
        renderedVisitSections.add(visit.id);
        visitHtml = renderVisitSection(state, visit);
      } else if (visit) {
        visitHtml = `<p class="merge-note">同址合并上门：${escapeHtml(visit.date)} ${escapeHtml(visit.slot)} · ${escapeHtml(
          technicianName(state, visit.technicianId)
        )}（见本组首项）</p>`;
      }
      return renderRepairCard(state, repair, visitHtml);
    })
    .join("");
}

function renderRepairCard(state, repair, visitHtml) {
  const reason = blockReason(repair);
  const missing = missingGates(repair);
  const gateLocked = Boolean(repair.visitId) && repair.stage !== "accepted" && repair.stage !== "overrun";
  const overLimit = repair.estimatedCost * 1.2;
  return `
    <article class="repair stage-${repair.stage}">
      <div class="photo">${
        repair.photo
          ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">`
          : "未添加照片"
      }</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.address)} · ${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.stage}">${stages[repair.stage]}</span>
          <span class="chip">${skills[repair.skill]}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          <span class="chip">承诺 ¥${Number(repair.estimatedCost || 0)}</span>
          ${repair.actualCost !== null ? `<span class="chip ${repair.actualCost > overLimit + 1e-9 ? "danger" : "ok"}">实际 ¥${repair.actualCost}</span>` : ""}
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>

        <div class="gates ${gateLocked ? "locked" : ""}">
          ${Object.entries(gates)
            .map(([key, label]) => {
              const done = repair.gates[key];
              return `
                <label class="gate ${done ? "done" : missing.includes(key) ? "todo" : ""}">
                  <input type="checkbox" data-action="gate" data-repair="${repair.id}" data-gate="${key}" ${
                done ? "checked" : ""
              } ${gateLocked ? "disabled" : ""}>
                  <span>${label}${done ? " ✓" : ""}</span>
                </label>
              `;
            })
            .join("")}
          ${
            !gatesReady(repair) && !repair.visitId
              ? `<p class="block">${escapeHtml(blockReason(repair))}，原排期不变</p>`
              : reason
              ? `<p class="block">${escapeHtml(reason)}</p>`
              : ""
          }
        </div>

        ${visitHtml}

        <div class="card-actions">
          ${repair.stage === "ready" || repair.stage === "rejected"
            ? `<button type="button" class="ghost" data-action="dispatch-one" data-repair="${repair.id}">仅安排本事项</button>`
            : ""}
          ${["work", "accepted", "overrun"].includes(repair.stage) ? renderCompletionForm(repair) : ""}
          ${["accepted", "overrun"].includes(repair.stage)
            ? `<button type="button" class="ghost" data-action="resume-rework" data-repair="${repair.id}">返工完成，恢复施工</button>`
            : ""}
          <button type="button" class="ghost" data-action="toggle-history" data-repair="${repair.id}">流转记录</button>
        </div>
        <div class="history" data-history="${repair.id}" hidden>
          ${repair.history.map((h) => `<div class="hist-line"><time>${escapeHtml(h.at)}</time><span>${escapeHtml(h.action)}${h.detail ? ` · ${escapeHtml(h.detail)}` : ""}</span></div>`).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderCompletionForm(repair) {
  const overLimit = repair.estimatedCost * 1.2;
  return `
    <form class="complete-form" data-form="complete" data-repair="${repair.id}">
      <label>实际费用（元）
        <input name="actualCost" type="number" min="0" step="1" value="${repair.actualCost ?? repair.estimatedCost}" required>
      </label>
      <label>业主验收
        <select name="acceptance">
          ${Object.entries(acceptanceResults)
            .map(([v, l]) => `<option value="${v}" ${repair.acceptance === v ? "selected" : ""}>${l}</option>`)
            .join("")}
        </select>
      </label>
      <input name="feedback" placeholder="退回原因/备注（可选）">
      <button class="primary" type="submit">登记完工</button>
      <small class="hint">承诺费用两成上限 ¥${overLimit.toFixed(0)}，超出即转退回处理中。</small>
    </form>
  `;
}

function renderVisitSection(state, visit) {
  const members = memberRepairs(state, visit);
  const statusLabel = { scheduled: "已排期", halted: "已停止", released: "已释放", done: "已完工" }[visit.status];
  const rects = openRectifications(state, visit.id);
  return `
    <section class="visit ${visit.status}">
      <div class="visit-head">
        <strong>上门单 · ${escapeHtml(visit.address)}</strong>
        <span class="status ${visit.status}">${statusLabel}</span>
        <span class="chip">${escapeHtml(visit.date)} ${escapeHtml(visit.slot)}</span>
        <span class="chip">${escapeHtml(technicianName(state, visit.technicianId))}</span>
        <span class="chip">合并 ${members.length} 项</span>
      </div>
      ${
        members.length > 1
          ? `<p class="merge-note">同址合并：${members.map((m) => escapeHtml(m.location)).join("、")}</p>`
          : ""
      }
      ${
        ["scheduled", "released"].includes(visit.status)
          ? `
        <form class="gate-check" data-form="precheck" data-visit="${visit.id}">
          <span class="check-title">开工前检查：</span>
          ${Object.entries(gateChecks)
            .map(
              ([key, check]) =>
                `<label class="gate danger-gate"><input type="checkbox" name="finding" value="${key}"><span>${check.label}</span></label>`
            )
            .join("")}
          <button class="primary" type="submit">提交检查并放行/停止</button>
        </form>`
          : ""
      }
      ${
        visit.status === "halted"
          ? `
        <div class="rect-list">
          <p class="block">立即停止，整改复检通过前不得继续施工（原约保留：${escapeHtml(visit.date)} ${escapeHtml(visit.slot)}）。</p>
          ${rects
            .map(
              (rect) => `
            <div class="rect ${rect.status}">
              <span class="chip danger">${gateChecks[rect.reason] ? gateChecks[rect.reason].label : "检查不通过"}</span>
              <span>${escapeHtml(rect.detail || "待补充整改说明")}</span>
              ${
                rect.status === "open"
                  ? `<div class="actions">
                      <button type="button" class="ghost" data-action="rect-pass" data-rect="${rect.id}">复检通过</button>
                      <button type="button" class="ghost" data-action="rect-fail" data-rect="${rect.id}">复检未过</button>
                    </div>`
                  : `<span class="chip ok">已复检通过 · ${escapeHtml(rect.closedAt || "")}</span>`
              }
            </div>`
            )
            .join("")}
        </div>`
          : ""
      }
      <details class="visit-history">
        <summary>上门单流转记录</summary>
        ${visit.history.map((h) => `<div class="hist-line"><time>${escapeHtml(h.at)}</time><span>${escapeHtml(h.action)}${h.detail ? ` · ${escapeHtml(h.detail)}` : ""}</span></div>`).join("")}
      </details>
    </section>
  `;
}

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]
  );
}
