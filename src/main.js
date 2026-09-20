// 接线层：加载本地数据、渲染、绑定页面事件、localStorage 同步（刷新保留 /
// 多标签页实时同步）。所有业务规则在 rules.js，视图在 components.js。

import "./styles.css";
import { loadState, saveState, SKILLS, PRIORITIES } from "./model.js";
import {
  addItem,
  completeGate,
  attemptBooking,
  attemptInspection,
  recheckRectification,
  registerCompletion
} from "./rules.js";
import { renderApp } from "./components.js";

let state = loadState();
const app = document.querySelector("#app");

function persistAndRender() {
  saveState(state);
  render();
}

function render() {
  app.innerHTML = renderApp(state);
  bindEvents();
}

function bindEvents() {
  app.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      persistAndRender();
    });
  });

  app.querySelector("#item-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target).entries());
    if (!SKILLS[data.skill] || !PRIORITIES[data.priority]) return;
    addItem(state, data);
    persistAndRender();
  });

  app.querySelectorAll('[data-action="gate"]').forEach((button) => {
    button.addEventListener("click", () => {
      completeGate(state, button.dataset.item, button.dataset.gate);
      persistAndRender();
    });
  });

  app.querySelectorAll('[data-action="book"]').forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      attemptBooking(state, {
        itemId: form.dataset.item,
        date: data.date,
        slot: data.slot
      });
      persistAndRender();
    });
  });

  app.querySelectorAll('[data-action="inspect"]').forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      attemptInspection(state, {
        visitId: form.dataset.visit,
        findings: data.getAll("finding"),
        note: String(data.get("note") || "").trim()
      });
      persistAndRender();
    });
  });

  app.querySelectorAll('[data-action="recheck"]').forEach((button) => {
    button.addEventListener("click", () => {
      recheckRectification(state, button.dataset.rect);
      persistAndRender();
    });
  });

  app.querySelectorAll('[data-action="complete"]').forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      registerCompletion(state, {
        itemId: form.dataset.item,
        actualCost: data.actualCost,
        acceptance: data.acceptance,
        note: String(data.note || "").trim()
      });
      persistAndRender();
    });
  });
}

// 其他标签页写入后即时同步当前视图
window.addEventListener("storage", (event) => {
  if (event.key && event.key.startsWith("zfl-14-dispatch")) {
    const filter = state.filter;
    state = loadState(event.newValue);
    state.filter = filter;
    render();
  }
});

render();
