// 入口与事件委托：加载本地状态、渲染页面、把页面动作转交给规则层并持久化（刷新保留）。

import "./styles.css";
import { loadState, saveState, createRepair, dateKey } from "./model.js";
import {
  setGate,
  attemptDispatch,
  preStartCheck,
  recheckRectification,
  registerCompletion,
  resumeRework
} from "./rules.js";
import { renderApp } from "./components.js";

let state = loadState();
if (!state.dispatchDate) state.dispatchDate = dateKey(0);

const app = document.querySelector("#app");

function render() {
  saveState(state);
  app.innerHTML = renderApp(state);
}

app.addEventListener("click", (event) => {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  switch (action) {
    case "dismiss-notice":
      state.notice = null;
      break;
    case "filter":
      state.filter = actionEl.dataset.filter;
      break;
    case "dispatch-date":
      return; // change 事件单独处理
    case "dispatch-all":
      attemptDispatch(state, {});
      break;
    case "dispatch-one":
      attemptDispatch(state, { repairId: actionEl.dataset.repair });
      break;
    case "gate":
      // checkbox 的切换在 change 中处理，避免双重翻转
      return;
    case "rect-pass":
      recheckRectification(state, actionEl.dataset.rect, true);
      break;
    case "rect-fail":
      recheckRectification(state, actionEl.dataset.rect, false);
      break;
    case "resume-rework":
      resumeRework(state, actionEl.dataset.repair);
      break;
    case "toggle-history": {
      const box = app.querySelector(`[data-history="${actionEl.dataset.repair}"]`);
      if (box) box.hidden = !box.hidden;
      return; // 纯展示切换，无需重渲染
    }
    default:
      return;
  }
  render();
});

app.addEventListener("change", (event) => {
  const el = event.target;
  if (el.matches('[data-action="gate"]')) {
    setGate(state, el.dataset.repair, el.dataset.gate, el.checked);
    render();
  } else if (el.matches('[data-action="dispatch-date"]')) {
    state.dispatchDate = el.value || dateKey(0);
    render();
  }
});

app.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const kind = form.dataset.form;

  if (kind === "create") {
    const data = Object.fromEntries(new FormData(form).entries());
    state.repairs.push(
      createRepair({
        address: data.address.trim(),
        location: data.location.trim(),
        title: data.title.trim(),
        priority: data.priority,
        skill: data.skill,
        estimatedCost: Number(data.estimatedCost || 0),
        photo: (data.photo || "").trim(),
        note: (data.note || "").trim()
      })
    );
    state.filter = "all";
    state.notice = { message: "事项已登记，先完成测量、备料、业主确认三道前置", at: Date.now() };
  } else if (kind === "precheck") {
    const visitId = form.dataset.visit;
    const findings = [...form.querySelectorAll('input[name="finding"]:checked')].map((i) => i.value);
    preStartCheck(state, visitId, findings.length ? findings : ["ok"]);
  } else if (kind === "complete") {
    const data = Object.fromEntries(new FormData(form).entries());
    registerCompletion(
      state,
      form.dataset.repair,
      Number(data.actualCost || 0),
      data.acceptance,
      (data.feedback || "").trim()
    );
  }
  render();
});

render();
