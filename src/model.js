// 数据模型层：实体结构、枚举、本地数据同步（localStorage）与种子数据。
// 不包含任何业务判断，规则一律放在 rules.js。

export const STORAGE_KEY = "zfl-14-dispatch-v1";

export const PRIORITIES = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

export const ITEM_STATUS = {
  pending: "待放行",
  scheduled: "已排期",
  halted: "停工整改",
  doing: "处理中",
  done: "已验收"
};

export const FILTERS = {
  all: "全部",
  pending: "待放行",
  scheduled: "已排期",
  halted: "停工整改",
  doing: "处理中",
  done: "已验收"
};

export const SKILLS = {
  plumbing: "水电",
  carpentry: "木工",
  masonry: "泥瓦",
  appliance: "家电"
};

// 三道前置：顺序即测量 → 备料 → 业主确认
export const GATES = [
  { key: "measure", label: "现场测量" },
  { key: "materials", label: "备料" },
  { key: "ownerConfirm", label: "业主确认" }
];

// 当日两小时时段
export const SLOTS = [
  "08:00–10:00",
  "10:00–12:00",
  "12:00–14:00",
  "14:00–16:00",
  "16:00–18:00"
];

// 开工前检查的三类异常，命中任一即停止
export const FINDINGS = {
  power: "断电",
  scope: "擅自扩项",
  safety: "安全条件不符"
};

export const COMPLETION_REASONS = {
  overrun: "实际费用超承诺两成",
  rejected: "业主验收退回"
};

const blankGate = () => ({ done: false, at: null });
const doneGate = (at) => ({ done: true, at });
const pad = (n) => String(n).padStart(2, "0");

function dateAt(dayOffset, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(minute)}`;
}

export function todayISO() {
  return dateAt(0, 0).slice(0, 10);
}

export function nowISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function createItem(input) {
  return {
    id: crypto.randomUUID(),
    address: String(input.address || "").trim(),
    location: String(input.location || "").trim(),
    title: String(input.title || "").trim(),
    skill: input.skill,
    priority: input.priority,
    estimatedCost: Number(input.estimatedCost || 0),
    photo: String(input.photo || "").trim(),
    note: String(input.note || "").trim(),
    status: "pending",
    gates: { measure: blankGate(), materials: blankGate(), ownerConfirm: blankGate() },
    visitId: null,
    completions: [], // 完工登记只追加
    rejection: null, // 最近一次整次拒绝（候选顺序保留在历史与此处）
    createdAt: nowISO()
  };
}

const doneGates = (a, b, c) => ({
  measure: doneGate(a),
  materials: doneGate(b),
  ownerConfirm: doneGate(c)
});

function seedItem(id, patch) {
  return {
    id,
    address: "",
    location: "",
    title: "",
    skill: "plumbing",
    priority: "medium",
    estimatedCost: 0,
    photo: "",
    note: "",
    status: "pending",
    gates: { measure: blankGate(), materials: blankGate(), ownerConfirm: blankGate() },
    visitId: null,
    completions: [],
    rejection: null,
    createdAt: dateAt(-7, 9),
    ...patch
  };
}

const eve = (type, itemIds, text, at) => ({ id: crypto.randomUUID(), type, itemIds, text, at });

function createInitialState() {
  const technicians = [
    { id: "t1", name: "张师傅", order: 1, skills: ["plumbing", "appliance"] },
    { id: "t2", name: "李师傅", order: 2, skills: ["plumbing", "masonry"] },
    { id: "t3", name: "王师傅", order: 3, skills: ["carpentry", "masonry"] },
    { id: "t4", name: "赵师傅", order: 4, skills: ["plumbing", "carpentry", "masonry"] }
  ];

  const items = [
    // 城南花苑2-401：r1 卡在测量之后；r2 三道前置已齐，可尝试预约
    seedItem("r1", {
      address: "城南花苑2-401",
      location: "厨房",
      title: "水槽下方渗水",
      skill: "plumbing",
      priority: "high",
      estimatedCost: 260,
      note: "先检查软管接口",
      createdAt: dateAt(-5, 9),
      gates: { measure: doneGate(dateAt(-4, 10)), materials: blankGate(), ownerConfirm: blankGate() }
    }),
    seedItem("r2", {
      address: "城南花苑2-401",
      location: "卫生间",
      title: "地漏返味、地面积水",
      skill: "plumbing",
      priority: "medium",
      estimatedCost: 180,
      note: "业主白天可上门",
      createdAt: dateAt(-4, 9),
      gates: doneGates(dateAt(-3, 10), dateAt(-2, 15), dateAt(-2, 19))
    }),
    // 东湖名邸7-1203：两事项同址且技能互补，预约时应合并为一次上门
    seedItem("r3", {
      address: "东湖名邸7-1203",
      location: "主卧",
      title: "木门下坠、开合刮地",
      skill: "carpentry",
      priority: "high",
      estimatedCost: 420,
      createdAt: dateAt(-6, 9),
      gates: doneGates(dateAt(-5, 9), dateAt(-5, 16), dateAt(-4, 20))
    }),
    seedItem("r4", {
      address: "东湖名邸7-1203",
      location: "南阳台",
      title: "墙砖空鼓，局部有脱落风险",
      skill: "masonry",
      priority: "medium",
      estimatedCost: 600,
      createdAt: dateAt(-5, 9),
      gates: doneGates(dateAt(-4, 10), dateAt(-4, 16), dateAt(-3, 20))
    }),
    // 已排期待开工：开工前检查入口
    seedItem("r5", {
      address: "书香美地1-902",
      location: "客厅",
      title: "空调内机异响，制冷变慢",
      skill: "appliance",
      priority: "medium",
      estimatedCost: 350,
      status: "scheduled",
      visitId: "v1",
      createdAt: dateAt(-3, 9),
      gates: doneGates(dateAt(-3, 11), dateAt(-2, 14), dateAt(-2, 19))
    }),
    seedItem("r10", {
      address: "柳岸春晓5-603",
      location: "阁楼",
      title: "换气扇失修，排风不畅",
      skill: "appliance",
      priority: "low",
      estimatedCost: 220,
      status: "scheduled",
      visitId: "v6",
      createdAt: dateAt(-4, 9),
      gates: doneGates(dateAt(-3, 10), dateAt(-2, 11), dateAt(-2, 18))
    }),
    // 停工整改：一项整改已复检通过，仍有断电项未闭环，原约冻结
    seedItem("r6", {
      address: "清和坊6-302",
      location: "玄关",
      title: "感应灯不亮，配电箱附近无电",
      skill: "plumbing",
      priority: "high",
      estimatedCost: 300,
      status: "halted",
      visitId: "v2",
      createdAt: dateAt(-5, 9),
      gates: doneGates(dateAt(-4, 9), dateAt(-3, 15), dateAt(-3, 20))
    }),
    // 施工中：等待完工登记
    seedItem("r7", {
      address: "石竹园8-1501",
      location: "次卧",
      title: "墙面返潮起泡，需铲除重做",
      skill: "masonry",
      priority: "medium",
      estimatedCost: 800,
      status: "doing",
      visitId: "v3",
      createdAt: dateAt(-6, 9),
      gates: doneGates(dateAt(-5, 10), dateAt(-4, 15), dateAt(-4, 20))
    }),
    // 已验收结案
    seedItem("r8", {
      address: "梧桐里2-305",
      location: "书房",
      title: "插座面板松动更换",
      skill: "plumbing",
      priority: "low",
      estimatedCost: 150,
      status: "done",
      visitId: "v4",
      createdAt: dateAt(-8, 9),
      gates: doneGates(dateAt(-7, 10), dateAt(-6, 14), dateAt(-6, 19)),
      completions: [
        {
          id: "c1",
          at: dateAt(-1, 11, 20),
          actualCost: 150,
          acceptance: "passed",
          result: "done",
          reasons: [],
          note: "业主现场确认"
        }
      ]
    }),
    // 处理中：完工登记时实际费用超承诺两成，被退回处理中（历史保留）
    seedItem("r9", {
      address: "望湖阁3-1801",
      location: "主卫",
      title: "花洒及软管更换",
      skill: "plumbing",
      priority: "medium",
      estimatedCost: 200,
      status: "doing",
      visitId: "v5",
      createdAt: dateAt(-4, 9),
      gates: doneGates(dateAt(-3, 9), dateAt(-2, 13), dateAt(-2, 18)),
      completions: [
        {
          id: "c2",
          at: dateAt(0, 16, 40),
          actualCost: 260,
          acceptance: "passed",
          result: "returned",
          reasons: ["overrun"],
          note: "业主对加价有异议"
        }
      ]
    })
  ];

  const visits = [
    {
      id: "v1",
      code: "V0920-04",
      technicianId: "t1",
      date: dateAt(0, 0).slice(0, 10),
      slot: SLOTS[0],
      itemIds: ["r5"],
      status: "scheduled",
      createdAt: dateAt(-1, 10)
    },
    {
      id: "v6",
      code: "V0920-03",
      technicianId: "t1",
      date: dateAt(0, 0).slice(0, 10),
      slot: SLOTS[1],
      itemIds: ["r10"],
      status: "scheduled",
      createdAt: dateAt(-1, 10)
    },
    {
      id: "v2",
      code: "V0920-01",
      technicianId: "t2",
      date: dateAt(0, 0).slice(0, 10),
      slot: SLOTS[0],
      itemIds: ["r6"],
      status: "halted",
      createdAt: dateAt(-3, 11)
    },
    {
      id: "v3",
      code: "V0920-02",
      technicianId: "t3",
      date: dateAt(0, 0).slice(0, 10),
      slot: SLOTS[3],
      itemIds: ["r7"],
      status: "active",
      createdAt: dateAt(-1, 11)
    },
    {
      id: "v5",
      code: "V0920-05",
      technicianId: "t1",
      date: dateAt(0, 0).slice(0, 10),
      slot: SLOTS[4],
      itemIds: ["r9"],
      status: "active",
      createdAt: dateAt(-1, 16)
    },
    {
      id: "v4",
      code: "V0919-01",
      technicianId: "t1",
      date: dateAt(-1, 0).slice(0, 10),
      slot: SLOTS[1],
      itemIds: ["r8"],
      status: "done",
      createdAt: dateAt(-2, 10)
    }
  ];

  const rectifications = [
    {
      id: "rc1",
      visitId: "v2",
      reason: "power",
      detail: "整户断电，无法验电施工",
      status: "open",
      createdAt: dateAt(0, 8, 5),
      recheckedAt: null
    },
    {
      id: "rc2",
      visitId: "v2",
      reason: "safety",
      detail: "配电箱裸露，已加装防护盖",
      status: "passed",
      createdAt: dateAt(0, 8, 5),
      recheckedAt: dateAt(0, 8, 25)
    }
  ];

  const events = [
    eve("created", ["r1"], "登记维修事项：城南花苑2-401 厨房 水槽下方渗水", dateAt(-5, 9)),
    eve("gate", ["r1"], "前置完成：现场测量", dateAt(-4, 10)),
    eve("created", ["r2"], "登记维修事项：城南花苑2-401 卫生间 地漏返味、地面积水", dateAt(-4, 9)),
    eve("gate", ["r2"], "前置完成：现场测量", dateAt(-3, 10)),
    eve("gate", ["r2"], "前置完成：备料", dateAt(-2, 15)),
    eve("gate", ["r2"], "前置完成：业主确认", dateAt(-2, 19)),
    eve("created", ["r3"], "登记维修事项：东湖名邸7-1203 主卧 木门下坠、开合刮地", dateAt(-6, 9)),
    eve("gate", ["r3"], "前置完成：现场测量", dateAt(-5, 9)),
    eve("gate", ["r3"], "前置完成：备料", dateAt(-5, 16)),
    eve("gate", ["r3"], "前置完成：业主确认", dateAt(-4, 20)),
    eve("created", ["r4"], "登记维修事项：东湖名邸7-1203 南阳台 墙砖空鼓，局部有脱落风险", dateAt(-5, 9)),
    eve("gate", ["r4"], "前置完成：现场测量", dateAt(-4, 10)),
    eve("gate", ["r4"], "前置完成：备料", dateAt(-4, 16)),
    eve("gate", ["r4"], "前置完成：业主确认", dateAt(-3, 20)),
    eve("created", ["r5"], "登记维修事项：书香美地1-902 客厅 空调内机异响，制冷变慢", dateAt(-3, 9)),
    eve("gate", ["r5"], "前置完成：现场测量", dateAt(-3, 11)),
    eve("gate", ["r5"], "前置完成：备料", dateAt(-2, 14)),
    eve("gate", ["r5"], "前置完成：业主确认", dateAt(-2, 19)),
    eve("scheduled", ["r5"], "排期成功：约 V0920-04 张师傅 09-20 08:00–10:00", dateAt(-1, 10)),
    eve("created", ["r10"], "登记维修事项：柳岸春晓5-603 阁楼 换气扇失修，排风不畅", dateAt(-4, 9)),
    eve("gate", ["r10"], "前置完成：现场测量", dateAt(-3, 10)),
    eve("gate", ["r10"], "前置完成：备料", dateAt(-2, 11)),
    eve("gate", ["r10"], "前置完成：业主确认", dateAt(-2, 18)),
    eve("scheduled", ["r10"], "排期成功：约 V0920-03 张师傅 09-20 10:00–12:00", dateAt(-1, 10)),
    eve("created", ["r6"], "登记维修事项：清和坊6-302 玄关 感应灯不亮，配电箱附近无电", dateAt(-5, 9)),
    eve("gate", ["r6"], "前置完成：现场测量", dateAt(-4, 9)),
    eve("gate", ["r6"], "前置完成：备料", dateAt(-3, 15)),
    eve("gate", ["r6"], "前置完成：业主确认", dateAt(-3, 20)),
    eve("scheduled", ["r6"], "排期成功：约 V0920-01 李师傅 09-20 08:00–10:00", dateAt(-3, 11)),
    eve("inspection_failed", ["r6"], "开工前检查发现 断电、安全条件不符，立即停止；已生成整改项，原约冻结", dateAt(0, 8, 5)),
    eve("recheck", ["r6"], "整改复检通过：安全条件不符（配电箱防护）", dateAt(0, 8, 25)),
    eve("created", ["r7"], "登记维修事项：石竹园8-1501 次卧 墙面返潮起泡，需铲除重做", dateAt(-6, 9)),
    eve("gate", ["r7"], "前置完成：现场测量", dateAt(-5, 10)),
    eve("gate", ["r7"], "前置完成：备料", dateAt(-4, 15)),
    eve("gate", ["r7"], "前置完成：业主确认", dateAt(-4, 20)),
    eve("scheduled", ["r7"], "排期成功：约 V0920-02 王师傅 09-20 14:00–16:00", dateAt(-1, 11)),
    eve("inspection_passed", ["r7"], "开工前检查通过，准予开工", dateAt(0, 14, 2)),
    eve("created", ["r8"], "登记维修事项：梧桐里2-305 书房 插座面板松动更换", dateAt(-8, 9)),
    eve("gate", ["r8"], "前置完成：现场测量", dateAt(-7, 10)),
    eve("gate", ["r8"], "前置完成：备料", dateAt(-6, 14)),
    eve("gate", ["r8"], "前置完成：业主确认", dateAt(-6, 19)),
    eve("scheduled", ["r8"], "排期成功：约 V0919-01 张师傅 09-19 10:00–12:00", dateAt(-2, 10)),
    eve("inspection_passed", ["r8"], "开工前检查通过，准予开工", dateAt(-1, 10, 5)),
    eve("completion_done", ["r8"], "完工登记：实际 ¥150，业主验收通过 → 验收结案", dateAt(-1, 11, 20)),
    eve("created", ["r9"], "登记维修事项：望湖阁3-1801 主卫 花洒及软管更换", dateAt(-4, 9)),
    eve("gate", ["r9"], "前置完成：现场测量", dateAt(-3, 9)),
    eve("gate", ["r9"], "前置完成：备料", dateAt(-2, 13)),
    eve("gate", ["r9"], "前置完成：业主确认", dateAt(-2, 18)),
    eve("scheduled", ["r9"], "排期成功：约 V0920-05 张师傅 09-20 16:00–18:00", dateAt(-1, 16)),
    eve("inspection_passed", ["r9"], "开工前检查通过，准予开工", dateAt(0, 16, 8)),
    eve("completion_returned", ["r9"], "完工登记：实际 ¥260，业主验收通过 → 退回处理中：实际费用超承诺两成（承诺 ¥200，上限 ¥240）", dateAt(0, 16, 40))
  ];

  return {
    version: 1,
    filter: "all",
    seq: { visit: 5 },
    technicians,
    items,
    visits,
    rectifications,
    events
  };
}

export function loadState(raw) {
  try {
    const saved = raw ?? localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.version === 1) return parsed;
    }
  } catch {
    // 落到种子数据
  }
  return createInitialState();
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
