// 数据模型层：事项、技师、上门、整改项与历史记录的结构、种子数据、本地读写与迁移。
// 不包含任何页面渲染与规则判定逻辑。

export const STORAGE_KEY = "zfl-14-repairs";
export const STORAGE_VERSION = 2;

// 当日两小时时段
export const SLOTS = ["08:00-10:00", "10:00-12:00", "13:00-15:00", "15:00-17:00", "17:00-19:00"];

export const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

export const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

// 技能/工种（“综合”代表全部技能都可承接）
export const skills = {
  plumbing: "水暖",
  electric: "电工",
  carpentry: "木工",
  appliance: "家电",
  paint: "涂装",
  general: "综合"
};

// 事项生命周期阶段（筛选标签与之对应）
export const stages = {
  intake: "前置未齐",
  ready: "可约上门",
  scheduled: "已排上门",
  work: "施工中",
  rectify: "整改中",
  done: "已完工",
  accepted: "验收退回",
  overrun: "费用超承诺",
  rejected: "排期拒绝"
};

export const stageFilters = {
  all: "全部",
  ...stages
};

export const gates = {
  measure: "测量",
  material: "备料",
  ownerConfirm: "业主确认"
};

export const acceptanceResults = {
  pass: "验收通过",
  return: "验收退回"
};

export const gateChecks = {
  power: { label: "现场断电", stop: true },
  scope: { label: "擅自扩项", stop: true },
  safety: { label: "安全条件不符", stop: true }
};

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowText() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 历史只追加：所有状态流转都只能通过该入口写入
export function appendHistory(target, action, detail = "") {
  target.history = target.history || [];
  target.history.push({ at: nowText(), action, detail });
}

export function createRepair(data) {
  const repair = {
    id: uid(),
    address: data.address || "本宅302",
    location: data.location,
    title: data.title,
    priority: data.priority || "medium",
    skill: data.skill || "general",
    estimatedCost: Number(data.estimatedCost || 0), // 承诺费用
    actualCost: null,
    photo: data.photo || "",
    note: data.note || "",
    createdAt: Date.now(),
    stage: "intake",
    gates: { measure: false, material: false, ownerConfirm: false },
    visitId: null,
    acceptance: null, // pass | return | null
    history: []
  };
  appendHistory(repair, "登记事项", `${repair.address} · ${repair.location}`);
  return repair;
}

export function createTechnician(data) {
  return {
    id: uid(),
    name: data.name,
    skills: data.skills, // 技能数组，general 表示全能
    // blockouts: { 'YYYY-MM-DD': ['10:00-12:00', ...] } 已被外部占用的时段
    blockouts: data.blockouts || {},
    active: true
  };
}

export function createRectification(data) {
  return {
    id: uid(),
    repairId: data.repairId,
    visitId: data.visitId,
    reason: data.reason,
    detail: data.detail || "",
    status: "open", // open | passed
    createdAt: nowText(),
    closedAt: null,
    history: []
  };
}

// ---------- 本地数据同步 ----------

export function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.version === STORAGE_VERSION) return parsed;
      return migrateState(parsed, saved);
    } catch {
      // 数据损坏时回落到种子数据
    }
  }
  return seedState();
}

export function saveState(state) {
  const persist = { ...state, notice: null }; // 提示是瞬时 UI 状态，不入库
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
}

// v1（旧版家庭维修事项）→ v2（上门施工放行台）
function migrateState(parsed, raw) {
  const base = seedState();
  const old = parsed && Array.isArray(parsed.repairs) ? parsed : JSON.parse(raw);
  base.repairs = (old.repairs || []).map((r) => {
    const doing = r.status === "doing";
    const done = r.status === "done";
    const repair = {
      id: r.id || uid(),
      address: r.address || "本宅302",
      location: r.location || "未填位置",
      title: r.title || "维修事项",
      priority: r.priority || "medium",
      skill: "general",
      estimatedCost: Number(r.cost || 0),
      actualCost: null,
      photo: r.photo || "",
      note: r.note || "",
      createdAt: Date.now(),
      stage: done ? "done" : doing ? "ready" : "intake",
      gates: {
        measure: doing || done,
        material: doing || done,
        ownerConfirm: doing || done
      },
      visitId: null,
      acceptance: done ? "pass" : null,
      history: []
    };
    appendHistory(repair, "旧版数据迁移", `原状态：${r.status}`);
    return repair;
  });
  return base;
}

// ---------- 种子数据 ----------

export function seedState() {
  const today = dateKey(0);
  const tomorrow = dateKey(1);

  const t1 = createTechnician({
    name: "周建国",
    skills: ["plumbing"],
    blockouts: { [tomorrow]: ["13:00-15:00"] } // 下午外部培训
  });
  const t2 = createTechnician({ name: "林晓梅", skills: ["electric", "appliance"] });
  const t3 = createTechnician({ name: "陈师傅", skills: ["carpentry", "paint"] });
  const t4 = createTechnician({
    name: "赵全能",
    skills: ["general"],
    blockouts: { [tomorrow]: ["08:00-10:00", "10:00-12:00"] } // 上午另有外单
  });

  const repairs = [
    repairSeed({
      address: "本宅302",
      location: "厨房",
      title: "水槽下方渗水",
      priority: "high",
      skill: "plumbing",
      estimatedCost: 260,
      note: "先检查软管接口",
      gates: { measure: true, material: true, ownerConfirm: false }
    }),
    repairSeed({
      address: "本宅302",
      location: "客厅",
      title: "吊灯接触不良",
      priority: "medium",
      skill: "electric",
      estimatedCost: 180,
      gates: { measure: true, material: true, ownerConfirm: true }
    }),
    repairSeed({
      address: "本宅302",
      location: "卧室",
      title: "墙面起皮重新刷漆",
      priority: "low",
      skill: "paint",
      estimatedCost: 600,
      gates: { measure: true, material: true, ownerConfirm: true }
    }),
    repairSeed({
      address: "本宅302",
      location: "阳台",
      title: "洗衣机进水管更换",
      priority: "medium",
      skill: "appliance",
      estimatedCost: 220,
      gates: { measure: false, material: false, ownerConfirm: true },
      note: "管子还没量尺寸"
    }),
    repairSeed({
      address: "幸福里7栋501",
      location: "玄关",
      title: "入户门下沉，关门异响",
      priority: "medium",
      skill: "carpentry",
      estimatedCost: 350,
      gates: { measure: true, material: true, ownerConfirm: true }
    }),
    repairSeed({
      address: "幸福里7栋501",
      location: "厨房",
      title: "吊柜合页更换",
      priority: "low",
      skill: "carpentry",
      estimatedCost: 120,
      gates: { measure: true, material: true, ownerConfirm: true }
    })
  ];

  // 已排上门（昨天），用于演示开工前检查
  const yesterday = dateKey(-1);
  const scheduledVisit = {
    id: uid(),
    address: "本宅302",
    date: yesterday,
    slot: "15:00-17:00",
    technicianId: t1.id,
    status: "scheduled", // scheduled | halted | released | done
    memberIds: [repairs[0].id],
    history: []
  };
  appendHistory(scheduledVisit, "系统排期", `${yesterday} 15:00-17:00 · 周建国`);
  repairs[0].gates.ownerConfirm = true;
  repairs[0].stage = "scheduled";
  repairs[0].visitId = scheduledVisit.id;
  appendHistory(repairs[0], "排期通过", `${yesterday} 15:00-17:00`);

  // 已被停止、等待整改的上门（前天）
  const haltedRepair = repairSeed({
    address: "本宅302",
    location: "卫生间",
    title: "浴霸线路改造",
    priority: "high",
    skill: "electric",
    estimatedCost: 300,
    gates: { measure: true, material: true, ownerConfirm: true }
  });
  const haltedVisit = {
    id: uid(),
    address: "本宅302",
    date: dateKey(-2),
    slot: "10:00-12:00",
    technicianId: t2.id,
    status: "halted",
    memberIds: [haltedRepair.id],
    history: []
  };
  appendHistory(haltedVisit, "系统排期", `${dateKey(-2)} 10:00-12:00 · 林晓梅`);
  appendHistory(haltedVisit, "开工检查停止", "安全条件不符：浴室漏电保护未安装");
  haltedRepair.stage = "rectify";
  haltedRepair.visitId = haltedVisit.id;
  appendHistory(haltedRepair, "开工检查停止", "安全条件不符");
  const rectification = createRectification({
    repairId: haltedRepair.id,
    visitId: haltedVisit.id,
    reason: "safety",
    detail: "加装漏电保护并复测线路绝缘"
  });
  appendHistory(rectification, "生成整改项", gateChecks.safety.label);

  // 已完工且验收通过的历史（只追加，保留）
  const doneRepair = repairSeed({
    address: "本宅302",
    location: "次卧",
    title: "窗锁更换",
    priority: "low",
    skill: "carpentry",
    estimatedCost: 90,
    actualCost: 90,
    gates: { measure: true, material: true, ownerConfirm: true }
  });
  const doneVisit = {
    id: uid(),
    address: "本宅302",
    date: dateKey(-5),
    slot: "08:00-10:00",
    technicianId: t3.id,
    status: "done",
    memberIds: [doneRepair.id],
    history: []
  };
  appendHistory(doneVisit, "系统排期", `${dateKey(-5)} 08:00-10:00 · 陈师傅`);
  appendHistory(doneVisit, "上门完工", "实际费用 ¥90");
  doneRepair.stage = "done";
  doneRepair.visitId = doneVisit.id;
  doneRepair.acceptance = "pass";
  appendHistory(doneRepair, "完工登记", "实际费用 ¥90");
  appendHistory(doneRepair, "业主验收", "验收通过");

  repairs.push(haltedRepair, doneRepair);

  return {
    version: STORAGE_VERSION,
    filter: "all",
    dispatchDate: today,
    technicians: [t1, t2, t3, t4],
    repairs,
    visits: [scheduledVisit, haltedVisit, doneVisit],
    rectifications: [rectification],
    attempts: [], // 排期尝试（含被整次拒绝的候选顺序）
    notice: null
  };
}

function repairSeed(partial) {
  const repair = {
    id: uid(),
    address: partial.address,
    location: partial.location,
    title: partial.title,
    priority: partial.priority,
    skill: partial.skill,
    estimatedCost: partial.estimatedCost,
    actualCost: partial.actualCost ?? null,
    photo: partial.photo || "",
    note: partial.note || "",
    createdAt: Date.now() + Math.floor(Math.random() * 1000),
    stage:
      partial.gates.measure && partial.gates.material && partial.gates.ownerConfirm
        ? "ready"
        : "intake",
    gates: { ...partial.gates },
    visitId: null,
    acceptance: null,
    history: []
  };
  appendHistory(repair, "登记事项", `${repair.address} · ${repair.location}`);
  return repair;
}

export function dateKey(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
