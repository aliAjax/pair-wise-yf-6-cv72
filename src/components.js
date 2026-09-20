// 页面组件层：统计、筛选、新增表单、事项卡片（前置 / 预约 / 约次 /
// 整改 / 完工 / 历史）的全部渲染。纯字符串输出，不含规则判断写入。

import {
  FILTERS,
  PRIORITIES,
  SKILLS,
  GATES,
  SLOTS,
  FINDINGS,
  COMPLETION_REASONS,
  ITEM_STATUS,
  todayISO
} from "./model.js";
import {
  gateInfo,
  visitById,
  technicianById,
  visitRectifications,
  itemEvents,
  filteredItems,
  computeStats,
  schedulableItems
} from "./rules.js";

export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]
  );
}

const fmtDateTime = (at) => escapeHtml(String(at).replace("T", " "));
const fmtMoney = (value) => `¥${Number(value || 0)}`;

const optionList = (map, selected) =>
  Object.entries(map)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");

function renderStats(stats) {
  return `
    <section class="stats">
      ${stats
        .map(
          (stat) => `
        <div class="stat stat-${stat.key}">
          <span>${stat.label}</span>
          <strong>${stat.value}</strong>
          <em>${escapeHtml(stat.hint)}</em>
        </div>`
        )
        .join("")}
    </section>`;
}

function renderForm() {
  return `
    <aside class="panel">
      <h2>登记维修事项</h2>
      <form class="form" id="item-form">
        <label>小区 / 门牌<input name="address" required placeholder="例如城南花苑2-401，同址用于合并上门"></label>
        <label>位置<input name="location" required placeholder="例如卫生间"></label>
        <label>问题描述<textarea name="title" required placeholder="例如地漏返味、地面积水"></textarea></label>
        <div class="form-grid">
          <label>工种<select name="skill">${optionList(SKILLS, "plumbing")}</select></label>
          <label>优先级<select name="priority">${optionList(PRIORITIES, "medium")}</select></label>
        </div>
        <label>承诺费用（元）<input name="estimatedCost" type="number" min="0" step="1" value="0"></label>
        <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
        <label>备注<textarea name="note" placeholder="材料、联系方式或注意事项"></textarea></label>
        <button class="primary" type="submit">登记事项（测量/备料/确认逐项放行）</button>
        <p class="form-hint">登记后依次完成三道前置，任一未完成不得预约上门。</p>
      </form>
    </aside>`;
}

function renderGates(item) {
  const info = gateInfo(item);
  const locked = item.status !== "pending";
  return `
    <div class="gates ${locked ? "locked" : ""}">
      ${GATES.map((gate, index) => {
        const state = item.gates[gate.key];
        const isNext = !locked && info.next && info.next.key === gate.key;
        return `
          <div class="gate ${state.done ? "done" : isNext ? "next" : "wait"}">
            <span class="gate-index">${index + 1}</span>
            <div class="gate-body">
              <strong>${gate.label}</strong>
              ${
                state.done
                  ? `<small>已完成 · ${fmtDateTime(state.at)}</small>`
                  : isNext
                    ? `<small>当前待办</small><button type="button" class="mini" data-action="gate" data-item="${item.id}" data-gate="${gate.key}">完成${gate.label}</button>`
                    : `<small>${locked ? "已随约次锁定" : "前序完成后开放"}</small>`
              }
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

function renderRejection(item) {
  const rejection = item.rejection;
  if (!rejection) return "";
  return `
    <div class="reject">
      <strong>最近一次整次拒绝（${escapeHtml(rejection.date)} ${escapeHtml(rejection.slot)}）</strong>
      <p>候选顺序：${rejection.candidateNames.map((name) => escapeHtml(name)).join(" → ")}；该时段全部冲突。</p>
      <p>同址 ${rejection.groupIds.length} 项整组不拆，原排期不变，候选顺序保留，请改约其他时段。</p>
    </div>`;
}

function renderBooking(state, item) {
  const merge = schedulableItems(state).filter(
    (other) => other.address.trim() === item.address.trim() && other.id !== item.id
  );
  return `
    <form class="booking" data-action="book" data-item="${item.id}">
      <div class="booking-head">
        <strong>三道前置已齐，安排上门</strong>
        ${
          merge.length
            ? `<span class="merge-hint">将与同址 ${merge.length} 项合并（${merge
                .map((member) => escapeHtml(member.location))
                .join("、")}），仅占用一次两小时时段</span>`
            : `<span class="merge-hint">同址暂无可合并事项</span>`
        }
      </div>
      <div class="booking-row">
        <label class="inline">日期<input type="date" name="date" min="${todayISO()}" value="${todayISO()}" required></label>
        <label class="inline">时段<select name="slot">${SLOTS.map(
          (slot) => `<option value="${slot}">${slot}</option>`
        ).join("")}</select></label>
        <button class="mini primary-mini" type="submit">预约上门</button>
      </div>
    </form>
    ${renderRejection(item)}`;
}

function renderRectifications(state, visit, primary) {
  const rects = visitRectifications(state, visit.id);
  if (!rects.length) return "";
  return `
    <ul class="rects">
      ${rects
        .map((rect) => {
          const label = FINDINGS[rect.reason];
          return `
          <li class="rect ${rect.status}">
            <div>
              <strong>${escapeHtml(label)}</strong>
              ${rect.detail ? `<p>${escapeHtml(rect.detail)}</p>` : ""}
              <small>${rect.status === "passed" ? `复检通过 · ${fmtDateTime(rect.recheckedAt)}` : `生成于 ${fmtDateTime(rect.createdAt)} · 待复检`}</small>
            </div>
            ${primary && rect.status === "open" ? `<button type="button" class="mini" data-action="recheck" data-rect="${rect.id}">复检通过</button>` : ""}
          </li>`;
        })
        .join("")}
    </ul>`;
}

function renderInspection(visit, primary) {
  if (!primary) {
    return `<p class="visit-note">本约为同址合并上门，开工前检查在本组首项卡片统一操作。</p>`;
  }
  return `
    <form class="inspection" data-action="inspect" data-visit="${visit.id}">
      <strong>开工前检查（命中任一项立即停止并生成整改项）</strong>
      <div class="checks">
        ${Object.entries(FINDINGS)
          .map(
            ([key, label]) =>
              `<label class="check"><input type="checkbox" name="finding" value="${key}">${escapeHtml(label)}</label>`
          )
          .join("")}
      </div>
      <label class="inline full">情况说明<input name="note" placeholder="可填写现场情况，无异常直接提交即可开工"></label>
      <button class="mini primary-mini" type="submit">提交开工前检查</button>
    </form>`;
}

function renderVisit(state, item) {
  const visit = visitById(state, item.visitId);
  if (!visit) return "";
  const tech = technicianById(state, visit.technicianId);
  const primary = visit.itemIds[0] === item.id;
  const others = visit.itemIds.map((id) => state.items.find((member) => member.id === id)).filter(Boolean);
  const openRects = visitRectifications(state, visit.id).filter((rect) => rect.status === "open").length;

  const body =
    visit.status === "scheduled"
      ? renderInspection(visit, primary)
      : visit.status === "halted"
        ? `
          <p class="visit-note freeze">已立即停止，原约冻结：日期时段 ${escapeHtml(visit.date)} ${escapeHtml(
            visit.slot
          )} 保持不变；${openRects ? `尚有 ${openRects} 项整改待复检，全部通过后才释放原约。` : ""}</p>
          ${renderRectifications(state, visit, primary)}
          ${primary ? "" : `<p class="visit-note">整改复检在本组首项卡片统一操作。</p>`}`
        : visit.status === "active"
          ? renderCompletion(item)
          : `<p class="visit-note">本约已随全部事项验收关闭。</p>`;

  return `
    <div class="visit visit-${visit.status}">
      <div class="visit-top">
        <strong>约 ${escapeHtml(visit.code)}</strong>
        <span class="chip">${escapeHtml(tech ? tech.name : "")}</span>
        <span class="chip">${escapeHtml(visit.date)} ${escapeHtml(visit.slot)}</span>
        <span class="chip">同址合并 ${others.length} 项：${others.map((member) => escapeHtml(member.location)).join("、")}</span>
      </div>
      ${body}
    </div>`;
}

function renderCompletion(item) {
  return `
    <form class="completion" data-action="complete" data-item="${item.id}">
      <strong>完工登记（实际费用 + 业主验收）</strong>
      <p class="visit-note">承诺费用 ${fmtMoney(
        item.estimatedCost
      )}，超出两成上限 ${fmtMoney(Math.round(item.estimatedCost * 1.2 * 100) / 100)} 将退回处理中。</p>
      <div class="booking-row">
        <label class="inline">实际费用（元）<input type="number" min="0" step="1" name="actualCost" value="${Number(
          item.estimatedCost || 0
        )}" required></label>
        <label class="inline">业主验收<select name="acceptance">
          <option value="passed">验收通过</option>
          <option value="rejected">验收退回</option>
        </select></label>
        <button class="mini primary-mini" type="submit">提交登记</button>
      </div>
      <label class="inline full">登记说明<input name="note" placeholder="可填写费用明细或业主意见"></label>
    </form>
    ${renderCompletionHistory(item)}`;
}

function renderCompletionHistory(item) {
  if (!item.completions.length) return "";
  return `
    <ul class="completions">
      ${item.completions
        .map(
          (record) => `
        <li class="completion-record ${record.result}">
          <div>
            <strong>${fmtDateTime(record.at)} 登记：实际 ${fmtMoney(record.actualCost)} · ${
              record.acceptance === "passed" ? "业主验收通过" : "业主验收退回"
            }</strong>
            ${
              record.reasons.length
                ? `<p>退回原因：${record.reasons.map((key) => escapeHtml(COMPLETION_REASONS[key])).join("、")}</p>`
                : `<p>验收结案</p>`
            }
            ${record.note ? `<small>${escapeHtml(record.note)}</small>` : ""}
          </div>
          <span class="record-badge ${record.result}">${record.result === "done" ? "结案" : "退回处理中"}</span>
        </li>`
        )
        .join("")}
    </ul>`;
}

function renderDoneSummary(item) {
  const latest = item.completions[item.completions.length - 1];
  if (!latest) return "";
  return `
    <div class="done-box">
      <strong>验收结案 · ${fmtDateTime(latest.at)}</strong>
      <span class="chip">承诺 ${fmtMoney(item.estimatedCost)}</span>
      <span class="chip">实际 ${fmtMoney(latest.actualCost)}</span>
      <span class="chip">业主验收通过</span>
    </div>`;
}

function renderHistory(state, item) {
  const events = itemEvents(state, item.id);
  return `
    <details class="history">
      <summary>流转历史（${events.length} 条，只追加不改写）</summary>
      <ol>
        ${events
          .map(
            (event) => `
          <li class="ev ev-${event.type}">
            <span class="ev-time">${fmtDateTime(event.at)}</span>
            <span class="ev-text">${escapeHtml(event.text)}</span>
          </li>`
          )
          .join("")}
      </ol>
    </details>`;
}

function renderCard(state, item) {
  const info = gateInfo(item);
  const blocked = item.status === "pending" && !info.allDone;
  return `
    <article class="repair status-card-${item.status}">
      <header class="card-head">
        <div class="head-main">
          <h3>${escapeHtml(item.address)} · ${escapeHtml(item.location)}</h3>
          <p class="title">${escapeHtml(item.title)}</p>
        </div>
        <div class="head-tags">
          <span class="status ${item.status}">${ITEM_STATUS[item.status]}</span>
          <span class="skill">${SKILLS[item.skill]}</span>
          <span class="priority ${item.priority}">${PRIORITIES[item.priority]}</span>
        </div>
        ${item.photo ? `<img class="thumb" src="${escapeHtml(item.photo)}" alt="${escapeHtml(item.location)}照片">` : ""}
      </header>

      <div class="meta-row">
        <span class="chip">承诺费用 ${fmtMoney(item.estimatedCost)}</span>
        <span class="chip">${escapeHtml(item.note || "暂无备注")}</span>
      </div>

      ${renderGates(item)}

      ${
        blocked
          ? `<div class="blocker"><strong>卡点：${info.missing
              .map((gate) => gate.label)
              .join("、")}未完成。</strong><p>三道前置任一未完成不得预约上门；本事项排期保持原状（${
              item.rejection ? "维持最近整次拒绝前的状态" : "尚未排期"
            }）。</p></div>`
          : ""
      }

      ${item.status === "pending" && info.allDone ? renderBooking(state, item) : ""}
      ${item.visitId ? renderVisit(state, item) : ""}
      ${item.status === "done" ? renderDoneSummary(item) : ""}
      ${renderHistory(state, item)}
    </article>`;
}

export function renderApp(state) {
  const items = filteredItems(state);
  const stats = computeStats(state);
  return `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台 · 三前置放行</p>
          <h1>上门施工放行台</h1>
        </div>
        ${renderStats(stats)}
      </header>

      <section class="layout">
        ${renderForm()}
        <section class="board">
          <div class="toolbar">
            ${Object.entries(FILTERS)
              .map(
                ([value, label]) =>
                  `<button type="button" class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`
              )
              .join("")}
          </div>
          <div class="repairs">
            ${items.length ? items.map((item) => renderCard(state, item)).join("") : `<div class="empty">当前筛选下没有维修事项</div>`}
          </div>
        </section>
      </section>
    </main>`;
}
