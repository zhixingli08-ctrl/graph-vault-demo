/* Graph Vault demo — local simulation, not mainnet */
(function () {
  "use strict";

  const MIN_QUOTE = 0.05;
  const MAX_NODE = 5;
  const AGENT_BONUS = 0.2;
  const POOL_N = 0.6, POOL_S = 0.25, POOL_I = 0.15;
  const QUIET = 1.0;
  const EDGE_WINDOW_MS = 10000;
  const COOLDOWN_MS = 1500;
  const NODE_TTL_EPOCHS = 28;
  const EDGE_TTL_EPOCHS = 4;
  const MAX_DEGREE = 6;
  const COUNTDOWN_START = 6 * 60;
  const TAX_RATE = 0.02;

  const state = {
    epoch: 1,
    pot: 0,
    rolled: 0,
    quiet: false,
    countdown: COUNTDOWN_START,
    nodes: new Map(),
    edges: [],
    lastRelay: null,
    me: "0xYOU0000000000000000000000000000demo",
    agentOn: false,
    claimable: 0,
    logSeq: 0,
    bots: [],
  };

  let lastBuyAt = 0;

  function short(a) {
    if (!a) return "—";
    return a.slice(0, 6) + "…" + a.slice(-4);
  }

  function randAddr() {
    const hex = "0123456789abcdef";
    let s = "0x";
    for (let i = 0; i < 40; i++) s += hex[(Math.random() * 16) | 0];
    return s;
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  function log(kind, html) {
    state.logSeq++;
    const box = document.getElementById("log");
    const row = document.createElement("div");
    row.className = "row";
    const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    row.innerHTML =
      '<span class="ts">[' + ts + ']</span> <span class="ev-' + kind + '">#' +
      String(state.logSeq).padStart(4, "0") + "</span> " + html;
    box.prepend(row);
    while (box.children.length > 80) box.removeChild(box.lastChild);
  }

  function ensureNode(addr, isAgent) {
    let n = state.nodes.get(addr);
    if (!n) {
      n = {
        addr: addr,
        isAgent: !!isAgent,
        buckets: [],
        x: 0.18 + Math.random() * 0.64,
        y: 0.18 + Math.random() * 0.64,
        vx: (Math.random() - 0.5) * 0.00045,
        vy: (Math.random() - 0.5) * 0.00045,
        pulse: 0,
        ignitePayEpoch: 0,
        ignitePayQ: 0,
      };
      state.nodes.set(addr, n);
    } else if (isAgent) {
      n.isAgent = true;
    }
    return n;
  }

  function effectiveLum(node, atEpoch) {
    let sum = 0;
    for (let i = 0; i < node.buckets.length; i++) {
      const b = node.buckets[i];
      const start = b.epoch + 1;
      const end = b.epoch + NODE_TTL_EPOCHS;
      if (atEpoch < start || atEpoch > end) continue;
      const rem = (NODE_TTL_EPOCHS + b.epoch + 1 - atEpoch) / NODE_TTL_EPOCHS;
      sum += b.w * rem;
    }
    return sum;
  }

  function totalLum(atEpoch) {
    let s = 0;
    state.nodes.forEach(function (n) { s += effectiveLum(n, atEpoch); });
    return s;
  }

  function liveNodeCount(atEpoch) {
    let c = 0;
    state.nodes.forEach(function (n) {
      if (effectiveLum(n, atEpoch) > 1e-9) c++;
    });
    return c;
  }

  function liveEdges(atEpoch) {
    return state.edges.filter(function (e) {
      const age = atEpoch - e.epoch;
      return age >= 0 && age < EDGE_TTL_EPOCHS;
    });
  }

  function synWeightOf(addr, atEpoch) {
    let s = 0;
    liveEdges(atEpoch).forEach(function (e) {
      if (e.a !== addr && e.b !== addr) return;
      const rem = (EDGE_TTL_EPOCHS - (atEpoch - e.epoch)) / EDGE_TTL_EPOCHS;
      s += e.w * rem;
    });
    return s;
  }

  function degreeInWindow(addr) {
    return liveEdges(state.epoch).filter(function (e) {
      return e.a === addr || e.b === addr;
    }).length;
  }

  function lightBuy(addr, quote, opts) {
    opts = opts || {};
    const role = opts.role || 0;
    const isMe = addr === state.me;
    const isAgent = opts.forceAgent != null
      ? opts.forceAgent
      : (isMe ? state.agentOn : !!opts.isAgent);

    if (!(quote >= MIN_QUOTE)) {
      toast("低于门槛 0.05 BNB");
      return false;
    }
    if (isMe && Date.now() - lastBuyAt < COOLDOWN_MS) {
      toast("冷却中（演示缩短）");
      return false;
    }

    const q = Math.min(quote, MAX_NODE);
    const w = q * (isAgent ? 1 + AGENT_BONUS : 1);
    const node = ensureNode(addr, isAgent);
    const wasDark = effectiveLum(node, state.epoch) < 1e-9;
    let hasBucketThisEpoch = false;
    for (let i = 0; i < node.buckets.length; i++) {
      if (node.buckets[i].epoch === state.epoch) { hasBucketThisEpoch = true; break; }
    }
    const isIgnite = wasDark && !hasBucketThisEpoch;

    node.buckets.push({ epoch: state.epoch, w: w });
    node.pulse = 1;
    if (isIgnite) {
      node.ignitePayEpoch = state.epoch + 1;
      node.ignitePayQ = q;
    }

    state.pot += quote * TAX_RATE;

    let linked = null;
    const now = Date.now();
    if (
      state.lastRelay &&
      state.lastRelay.addr !== addr &&
      now - state.lastRelay.at <= EDGE_WINDOW_MS
    ) {
      const a = state.lastRelay.addr < addr ? state.lastRelay.addr : addr;
      const b = state.lastRelay.addr < addr ? addr : state.lastRelay.addr;
      let exists = false;
      for (let i = 0; i < state.edges.length; i++) {
        const e = state.edges[i];
        if (e.a === a && e.b === b && state.epoch - e.epoch < EDGE_TTL_EPOCHS) {
          exists = true; break;
        }
      }
      if (!exists) {
        const sw = Math.min(q, state.lastRelay.q);
        const degOk = degreeInWindow(a) < MAX_DEGREE || degreeInWindow(b) < MAX_DEGREE;
        state.edges.push({ a: a, b: b, epoch: state.epoch, w: sw, scored: degOk });
        linked = { a: a, b: b, sw: sw };
      }
    }
    state.lastRelay = { addr: addr, at: now, q: q };
    if (isMe) lastBuyAt = now;

    const roleName = role === 1 ? "侦察" : role === 2 ? "接力" : role === 3 ? "补光" : "";
    let tag = "";
    if (isAgent || roleName) {
      tag = '<span class="tag">' +
        (isAgent ? "AGENT" : "") +
        (isAgent && roleName ? "·" : "") +
        roleName + "</span>";
    }

    log("node",
      '<span class="ev-node">节点亮起</span> ' + short(addr) +
      " +" + q.toFixed(3) + " BNB → 亮度 " + w.toFixed(3) + tag);

    if (isIgnite) {
      log("ignite",
        '<span class="ev-ignite">点火</span> ' + short(addr) +
        (node.buckets.length <= 1 ? " 首次点亮" : " 熄灭后重燃") +
        " · 计入 E-" + String(state.epoch + 1).padStart(4, "0") + " 点火池");
    }
    if (linked) {
      log("edge",
        '<span class="ev-edge">接力成边</span> ' + short(linked.a) + " — " +
        short(linked.b) + " · 突触 " + linked.sw.toFixed(3));
    }

    if (isMe) toast("已点亮 · 下纪元亮度 +" + w.toFixed(3));
    refreshUI();
    return true;
  }

  function settle() {
    const e = state.epoch;
    const Wn = totalLum(e);
    const edges = liveEdges(e);

    let sumEw = 0;
    let myEdgeW = 0;
    edges.forEach(function (ed) {
      const rem = (EDGE_TTL_EPOCHS - (e - ed.epoch)) / EDGE_TTL_EPOCHS;
      const ew = ed.w * rem;
      sumEw += ew;
      if (ed.a === state.me || ed.b === state.me) myEdgeW += ew;
    });

    let Wi = 0;
    const ignitePays = [];
    state.nodes.forEach(function (n) {
      if (n.ignitePayEpoch === e && n.ignitePayQ > 0) {
        Wi += n.ignitePayQ;
        ignitePays.push({ addr: n.addr, q: n.ignitePayQ });
      }
    });

    const pot = state.pot + state.rolled;
    state.rolled = 0;
    state.pot = 0;

    if (Wn < QUIET) {
      state.quiet = true;
      state.rolled = pot;
      log("quiet",
        '<span class="ev-quiet">网络休眠</span> Wn=' + Wn.toFixed(3) +
        " < 静默线 " + QUIET + " · " + pot.toFixed(4) + " BNB 滚入下一纪元");
      toast("网络休眠 · 税已滚存");
    } else {
      state.quiet = false;
      let pN = pot * POOL_N;
      let pS = pot * POOL_S;
      let pI = pot * POOL_I;
      if (sumEw < 1e-12) { pN += pS; pS = 0; }
      if (Wi < 1e-12) { pN += pI; pI = 0; }

      const meNode = state.nodes.get(state.me);
      const myWn = meNode ? effectiveLum(meNode, e) : 0;
      let myShare = 0;
      if (Wn > 0) myShare += pN * (myWn / Wn);
      if (sumEw > 0) myShare += pS * (myEdgeW / sumEw);
      for (let i = 0; i < ignitePays.length; i++) {
        if (ignitePays[i].addr === state.me && Wi > 0) {
          myShare += pI * (ignitePays[i].q / Wi);
        }
      }

      state.claimable += myShare;
      log("settle",
        '<span class="ev-settle">结算 E-' + String(e).padStart(4, "0") + "</span> 税罐 " +
        pot.toFixed(4) + " → 亮度 " + pN.toFixed(4) + " / 突触 " + pS.toFixed(4) +
        " / 点火 " + pI.toFixed(4) + " · 你分得 " + myShare.toFixed(5) + " BNB");
      toast("结算完成 · 可领 +" + myShare.toFixed(5) + " BNB");
    }

    state.nodes.forEach(function (n) {
      if (n.ignitePayEpoch === e) {
        n.ignitePayEpoch = 0;
        n.ignitePayQ = 0;
      }
    });

    state.epoch += 1;
    state.countdown = COUNTDOWN_START;
    refreshUI();
  }

  function claim() {
    if (state.claimable <= 0) {
      toast("暂无可领");
      return;
    }
    const amt = state.claimable;
    state.claimable = 0;
    log("claim", '<span class="ev-claim">领取</span> ' + short(state.me) + " +" + amt.toFixed(5) + " BNB");
    toast("已领取 " + amt.toFixed(5) + " BNB");
    refreshUI();
  }

  function refreshUI() {
    const e = state.epoch;
    const Wn = totalLum(e);
    const nodes = liveNodeCount(e);
    const edges = liveEdges(e);
    const pot = state.pot + state.rolled;

    document.getElementById("epochLabel").textContent = "E-" + String(e).padStart(4, "0");
    document.getElementById("statNodes").textContent = String(nodes);
    document.getElementById("statEdges").textContent = String(edges.length);
    document.getElementById("statPot").innerHTML = pot.toFixed(3) + "<em>BNB</em>";

    const m = Math.floor(state.countdown / 60);
    const s = state.countdown % 60;
    document.getElementById("statCountdown").textContent =
      String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");

    const quiet = Wn < QUIET;
    document.getElementById("quietBadge").classList.toggle("on", quiet);
    document.getElementById("quietBanner").classList.toggle("on", quiet);
    document.querySelectorAll(".pool").forEach(function (el) {
      el.classList.toggle("dimmed", quiet);
    });

    const pN = pot * POOL_N, pS = pot * POOL_S, pI = pot * POOL_I;
    document.getElementById("poolNAmt").innerHTML = pN.toFixed(3) + " <span>BNB</span>";
    document.getElementById("poolSAmt").innerHTML = pS.toFixed(3) + " <span>BNB</span>";
    document.getElementById("poolIAmt").innerHTML = pI.toFixed(3) + " <span>BNB</span>";
    document.getElementById("poolNBar").style.width = quiet ? "0%" : "100%";
    document.getElementById("poolSBar").style.width = quiet ? "0%" : "100%";
    document.getElementById("poolIBar").style.width = quiet ? "0%" : "100%";

    const me = state.nodes.get(state.me);
    const nextLum = me ? effectiveLum(me, e + 1) : 0;
    const cur = me ? effectiveLum(me, e) : 0;
    document.getElementById("myLum").textContent =
      nextLum.toFixed(3) + (cur ? " (当前 " + cur.toFixed(3) + ")" : "");
    document.getElementById("mySyn").textContent = synWeightOf(state.me, e).toFixed(3);
    const ig = me && me.ignitePayEpoch === e + 1 ? me.ignitePayQ : 0;
    document.getElementById("myIgn").textContent = ig
      ? ig.toFixed(3) + " @E-" + String(e + 1).padStart(4, "0")
      : "—";
    document.getElementById("myClaim").textContent = state.claimable.toFixed(5) + " BNB";

    let ag = 0, tot = 0;
    state.nodes.forEach(function (n) {
      if (effectiveLum(n, e) > 1e-9) {
        tot++;
        if (n.isAgent) ag++;
      }
    });
    document.getElementById("agentShare").textContent = tot
      ? "本轮 Agent 节点占比 " + (100 * ag / tot).toFixed(0) + "%（" + ag + "/" + tot + "）"
      : "本轮 Agent 节点占比 —";

    document.getElementById("graphMeta").textContent =
      "Wn " + Wn.toFixed(2) + " · 静默线 " + QUIET + " · 上一位 " +
      (state.lastRelay ? short(state.lastRelay.addr) : "—");
    document.getElementById("myAddr").textContent =
      short(state.me) + (state.agentOn ? " · AGENT" : "");
  }

  const INSTR = {
    scout: "【侦察】读 poolsNext() / quietGap()：若点火池空或全图接近静默线，用 0.08 BNB 调用图谱入口 lightBuy(minOut, roleTag=1)，币打回本钱包。只认官方 CA。",
    relay: "【接力】读 lastRelay()：若上一位买家距今 ≤ 600s，立即用 0.1 BNB 调用 lightBuy(minOut, roleTag=2) 接上突触。超时则等待下一位窗口。",
    boost: "【补光】读 nodeNextOf(自己)：亮度将在 2 纪元内熄灭则买入续命；若已熄灭则买入重新点火（roleTag=3）。单笔 0.05–0.2 BNB。",
  };
  let currentRole = "scout";

  function setInstr(role) {
    currentRole = role;
    document.getElementById("instrText").textContent = INSTR[role];
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.role === role);
    });
  }

  const canvas = document.getElementById("graph");
  const ctx = canvas.getContext("2d");

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(420 * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawGraph() {
    const w = canvas.getBoundingClientRect().width;
    const h = 420;
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(77,232,255,0.035)";
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const e = state.epoch;
    const nodes = [];
    state.nodes.forEach(function (n) {
      if (effectiveLum(n, e) > 1e-9 || n.pulse > 0.01) nodes.push(n);
    });
    const edges = liveEdges(e);

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0.08 || n.x > 0.92) n.vx *= -1;
      if (n.y < 0.1 || n.y > 0.9) n.vy *= -1;
      n.x = Math.max(0.06, Math.min(0.94, n.x));
      n.y = Math.max(0.08, Math.min(0.92, n.y));
      if (n.pulse > 0) n.pulse *= 0.92;
    }

    for (let i = 0; i < edges.length; i++) {
      const ed = edges[i];
      const na = state.nodes.get(ed.a);
      const nb = state.nodes.get(ed.b);
      if (!na || !nb) continue;
      const x1 = na.x * w, y1 = na.y * h;
      const x2 = nb.x * w, y2 = nb.y * h;
      const g = ctx.createLinearGradient(x1, y1, x2, y2);
      g.addColorStop(0, "rgba(167,139,250,0.55)");
      g.addColorStop(1, "rgba(77,232,255,0.4)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const lum = effectiveLum(n, e);
      const r = 4 + Math.min(18, Math.sqrt(Math.max(lum, 0.01)) * 10) + n.pulse * 8;
      const x = n.x * w, y = n.y * h;
      const isMe = n.addr === state.me;
      const lastB = n.buckets.length ? n.buckets[n.buckets.length - 1].epoch : -99;
      const fresh = state.epoch - lastB <= 1;

      const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      if (n.isAgent) {
        grad.addColorStop(0, "rgba(77,232,255,0.55)");
        grad.addColorStop(0.45, "rgba(167,139,250,0.18)");
        grad.addColorStop(1, "transparent");
      } else if (fresh) {
        grad.addColorStop(0, "rgba(125,211,252,0.5)");
        grad.addColorStop(1, "transparent");
      } else {
        grad.addColorStop(0, "rgba(167,139,250,0.32)");
        grad.addColorStop(1, "transparent");
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.isAgent ? "#4de8ff" : fresh ? "#7dd3fc" : "#a78bfa";
      ctx.fill();

      if (n.isAgent || isMe) {
        ctx.strokeStyle = isMe ? "#fbbf24" : "#e0f2fe";
        ctx.lineWidth = isMe ? 2 : 1.5;
        ctx.stroke();
      }

      if (isMe || lum > 0.25) {
        ctx.fillStyle = "rgba(232,236,248,0.78)";
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillText(isMe ? "YOU" : short(n.addr).slice(2, 6), x + r + 4, y + 3);
      }
    }

    if (nodes.length === 0) {
      ctx.fillStyle = "rgba(139,147,173,0.75)";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("图还是空的 — 点「图谱入口买入」点亮第一个节点", w / 2, h / 2);
      ctx.textAlign = "left";
    }

    requestAnimationFrame(drawGraph);
  }

  function seedWorld() {
    const bots = [];
    for (let i = 0; i < 7; i++) {
      bots.push({ addr: randAddr(), isAgent: i % 2 === 0, role: (i % 3) + 1 });
    }
    state.bots = bots;
    lightBuy(bots[0].addr, 0.12, { isAgent: true, role: 1 });
    setTimeout(function () { lightBuy(bots[1].addr, 0.08, { isAgent: false, role: 2 }); }, 350);
    setTimeout(function () { lightBuy(bots[2].addr, 0.15, { isAgent: true, role: 2 }); }, 800);
    setTimeout(function () { lightBuy(bots[3].addr, 0.06, { isAgent: false, role: 1 }); }, 1200);
    setTimeout(function () {
      state.pot += 0.42;
      refreshUI();
      log("settle", '<span class="ev-settle">演示注税</span> +0.420 BNB 进入本纪元奖池（模拟买卖税）');
    }, 1500);
  }

  function ambientTick() {
    if (!state.bots.length || Math.random() > 0.42) return;
    const b = state.bots[(Math.random() * state.bots.length) | 0];
    const amt = 0.05 + Math.random() * 0.16;
    lightBuy(b.addr, amt, { isAgent: b.isAgent, role: b.role });
    state.pot += amt * TAX_RATE;
  }

  document.getElementById("btnBuy").addEventListener("click", function () {
    const amt = parseFloat(document.getElementById("buyAmt").value);
    if (!isFinite(amt)) return toast("请输入金额");
    lightBuy(state.me, amt, { role: 0 });
  });

  document.getElementById("agentToggle").addEventListener("change", function (ev) {
    state.agentOn = ev.target.checked;
    toast(state.agentOn ? "Agent ID 已开 · 亮度写入 +20%" : "Agent 加成关闭");
    refreshUI();
  });

  document.getElementById("btnSettle").addEventListener("click", settle);
  document.getElementById("btnClaim").addEventListener("click", claim);

  document.querySelectorAll(".tab").forEach(function (t) {
    t.addEventListener("click", function () { setInstr(t.dataset.role); });
  });

  document.getElementById("btnCopy").addEventListener("click", function () {
    const text = INSTR[currentRole];
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("指令已复制"); },
        function () { toast("请手动复制"); });
    } else {
      toast("请手动复制");
    }
  });

  document.getElementById("btnRunRole").addEventListener("click", function () {
    const map = { scout: 1, relay: 2, boost: 3 };
    const amt = currentRole === "scout" ? 0.08 : currentRole === "relay" ? 0.1 : 0.12;
    document.getElementById("buyAmt").value = String(amt);
    lightBuy(state.me, amt, { role: map[currentRole] });
  });

  setInterval(function () {
    state.countdown = Math.max(0, state.countdown - 1);
    if (state.countdown === 0) state.countdown = COUNTDOWN_START;
    const m = Math.floor(state.countdown / 60);
    const s = state.countdown % 60;
    const el = document.getElementById("statCountdown");
    if (el) {
      el.textContent = String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }
  }, 1000);

  setInterval(ambientTick, 3200);
  window.addEventListener("resize", resizeCanvas);

  setInstr("scout");
  resizeCanvas();
  refreshUI();
  drawGraph();
  seedWorld();
  log("settle", '<span class="ev-settle">演示启动</span> 图谱金库本地模拟 · 三池 60/25/15 · 静默线 1 BNB');
})();
