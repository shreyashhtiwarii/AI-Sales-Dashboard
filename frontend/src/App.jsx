import { useEffect, useState, useRef, useCallback } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, Area,
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  PieChart, Pie,
} from "recharts";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

const get = async (u) => {
  // First attempt via relative URL (handled by Vite dev proxy on 5173)
  try {
    const res = await fetch(u);
    if (res.ok) return await res.json();
  } catch (_) {
    // Ignore and fallback to direct backend call
  }

  // Second attempt via direct backend URL
  const directUrl = (BASE.endsWith("/") ? BASE.slice(0, -1) : BASE) + u;
  const directRes = await fetch(directUrl);
  if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`);
  return await directRes.json();
};

const fmt$  = (n) => "$" + Math.round(n).toLocaleString();
const fmtK  = (n) => (n >= 1000 ? "$" + (n / 1000).toFixed(1) + "k" : "$" + Math.round(n));
const fmtAx = (v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

// ─── 3-D tilt hook ───────────────────────────────────────────────────────────
function useTilt(strength = 7) {
  const ref = useRef(null);
  const onMouseMove = useCallback((e) => {
    const el = ref.current;
    if (!el) return;
    el.style.transition = "border-color .3s, box-shadow .3s";
    const { left, top, width, height } = el.getBoundingClientRect();
    const x = ((e.clientX - left) / width  - 0.5) * strength;
    const y = ((e.clientY - top)  / height - 0.5) * strength;
    el.style.transform = `perspective(900px) rotateY(${x}deg) rotateX(${-y}deg) translateZ(6px)`;
  }, [strength]);
  const onMouseLeave = useCallback(() => {
    if (ref.current) {
      ref.current.style.transition = "transform .35s ease, border-color .3s, box-shadow .3s";
      ref.current.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg) translateZ(0px)";
    }
  }, []);
  return { ref, onMouseMove, onMouseLeave };
}

// ─── Animated counter hook ───────────────────────────────────────────────────
function useCountUp(end, duration = 1600) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (end == null) return;
    const num = typeof end === "string" ? parseFloat(end.replace(/[^0-9.-]/g, "")) : end;
    if (isNaN(num)) return;
    let start = null;
    let animId = null;
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min((ts - start) / duration, 1);
      setVal(Math.round(num * (1 - Math.pow(1 - p, 4))));
      if (p < 1) animId = requestAnimationFrame(tick);
    };
    animId = requestAnimationFrame(tick);
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [end, duration]);
  return val;
}

// ─── Sparkline SVG component ─────────────────────────────────────────────────
function Sparkline({ data = [], color = "#a78bfa" }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 72;
  const h = 26;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 6) - 3;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: "visible" }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

// ─── KPI meta ────────────────────────────────────────────────────────────────
const KPI_META = [
  { key: "revenue_30d",      changeKey: "revenue",   label: "Revenue (30d)",    fmt: fmtK,                              accent: "#a78bfa", glow: "rgba(167,139,250,.35)", delay: "0s"   },
  { key: "growth_pct",       changeKey: "growth",    label: "MoM Growth",       fmt: (n) => `${n > 0 ? "+" : ""}${n}%`, accent: "#34d399", glow: "rgba(52,211,153,.35)",  delay: ".08s" },
  { key: "orders_30d",       changeKey: "orders",    label: "Orders (30d)",     fmt: (n) => n.toLocaleString(),         accent: "#60a5fa", glow: "rgba(96,165,250,.35)",  delay: ".16s" },
  { key: "aov",              changeKey: "aov",       label: "Avg Order",        fmt: (n) => `$${Math.round(n)}`,        accent: "#fb923c", glow: "rgba(251,146,60,.35)",  delay: ".24s" },
  { key: "active_customers", changeKey: "customers", label: "Active Customers", fmt: (n) => n.toLocaleString(),         accent: "#f472b6", glow: "rgba(244,114,182,.35)", delay: ".32s" },
];

// ─── Segment colour map ──────────────────────────────────────────────────────
const SEG_COLORS = {
  Champions: { color: "#34d399", bg: "rgba(52,211,153,.10)",  border: "rgba(52,211,153,.25)"  },
  Growing:   { color: "#818cf8", bg: "rgba(129,140,248,.10)", border: "rgba(129,140,248,.25)" },
  "At Risk": { color: "#fbbf24", bg: "rgba(251,191,36,.10)",  border: "rgba(251,191,36,.25)"  },
  Lost:      { color: "#f87171", bg: "rgba(248,113,113,.10)", border: "rgba(248,113,113,.25)" },
};
const BAR_GRADS  = ["#6366f1","#8b5cf6","#06b6d4","#10b981","#f59e0b","#ec4899"];
const PIE_COLORS = ["#a78bfa","#60a5fa","#34d399","#fb923c","#f472b6","#fbbf24"];

// ─── Risk badge ──────────────────────────────────────────────────────────────
function RiskBadge({ prob }) {
  const pct = Math.round(prob * 100);
  const color = pct >= 70 ? "#f87171" : pct >= 40 ? "#fbbf24" : "#34d399";
  return (
    <span style={{
      padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: color + "18", border: `1px solid ${color}44`, color,
    }}>{pct}%</span>
  );
}

// ─── Custom chart tooltip ────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(2,8,23,.92)", border: "1px solid rgba(139,92,246,.35)",
      borderRadius: 12, padding: "10px 16px",
      backdropFilter: "blur(24px)", boxShadow: "0 24px 48px rgba(0,0,0,.6)",
    }}>
      <p style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>{label}</p>
      {payload.map((p) => {
        if (p.value == null) return null;
        let displayVal;
        if (Array.isArray(p.value)) {
          displayVal = `${fmt$(p.value[0])} – ${fmt$(p.value[1])}`;
        } else if (typeof p.value === "number") {
          displayVal = fmt$(p.value);
        } else {
          displayVal = p.value;
        }
        const name = p.name === "band" ? "95% Confidence" : (p.name || p.dataKey);
        return (
          <p key={p.dataKey || p.name} style={{ color: p.stroke || p.fill || "#e2e8f0", fontSize: 13, fontWeight: 600, margin: "2px 0" }}>
            {name}: {displayVal}
          </p>
        );
      })}
    </div>
  );
}

// ─── Pie tooltip ─────────────────────────────────────────────────────────────
function PieTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div style={{
      background: "rgba(2,8,23,.92)", border: "1px solid rgba(139,92,246,.35)",
      borderRadius: 12, padding: "10px 16px",
      backdropFilter: "blur(24px)", boxShadow: "0 24px 48px rgba(0,0,0,.6)",
    }}>
      <p style={{ color: d.payload.fill, fontSize: 13, fontWeight: 700 }}>{d.name}</p>
      <p style={{ color: "#e2e8f0", fontSize: 12, margin: "4px 0 2px" }}>{fmt$(d.value)}</p>
      <p style={{ color: "#475569", fontSize: 11 }}>{d.payload.share}% share • {d.payload.orders} orders</p>
    </div>
  );
}

// ─── Card wrapper ────────────────────────────────────────────────────────────
function Card({ children, style = {}, delay = "0s" }) {
  return (
    <div style={{
      background: "rgba(15,23,42,.75)",
      border: "1px solid rgba(148,163,184,.08)",
      borderRadius: 20,
      padding: "26px 28px",
      backdropFilter: "blur(24px)",
      animation: `fadeInUp .6s ${delay} both`,
      boxShadow: "0 4px 32px rgba(0,0,0,.3)",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── Section heading ─────────────────────────────────────────────────────────
function SectionHead({ title, sub, badge }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
      <div>
        <h2 style={{ color: "#f1f5f9", fontSize: 16, fontWeight: 700, margin: "0 0 4px", letterSpacing: "-.02em" }}>{title}</h2>
        {sub && <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>{sub}</p>}
      </div>
      {badge}
    </div>
  );
}

// ─── Chip badge ──────────────────────────────────────────────────────────────
function Chip({ label, color = "#a78bfa" }) {
  return (
    <div style={{ background: color + "18", border: `1px solid ${color}44`, borderRadius: 8, padding: "5px 12px" }}>
      <span style={{ color, fontSize: 12, fontWeight: 700 }}>{label}</span>
    </div>
  );
}

// ─── KPI card ────────────────────────────────────────────────────────────────
function KPICard({ label, value, fmt, accent, glow, delay, change, sparkline }) {
  const tilt = useTilt(6);
  const count = useCountUp(value);

  const isPos = change > 0;
  const isZero = change === 0 || change == null;

  return (
    <div
      {...tilt}
      style={{
        background: "rgba(15,23,42,.75)",
        border: `1px solid rgba(148,163,184,.08)`,
        borderRadius: 18,
        padding: "22px 20px",
        backdropFilter: "blur(24px)",
        cursor: "default",
        transition: "border-color .3s, box-shadow .3s",
        animation: `fadeInUp .55s ${delay} both`,
        transformStyle: "preserve-3d",
        willChange: "transform",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = accent + "55";
        e.currentTarget.style.boxShadow = `0 0 28px ${glow}, 0 20px 50px rgba(0,0,0,.45)`;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "rgba(148,163,184,.08)";
        e.currentTarget.style.boxShadow = "none";
        tilt.onMouseLeave();
      }}
    >
      <div style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(105deg, transparent 40%, ${accent}18 50%, transparent 60%)`,
        backgroundSize: "200% 100%",
        pointerEvents: "none",
      }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <p style={{ color: "#64748b", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".07em", margin: 0 }}>
          {label}
        </p>
        {change != null && (
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 6,
            background: isZero ? "rgba(148,163,184,.1)" : isPos ? "rgba(52,211,153,.15)" : "rgba(248,113,113,.15)",
            color: isZero ? "#94a3b8" : isPos ? "#34d399" : "#f87171",
            border: `1px solid ${isZero ? "rgba(148,163,184,.2)" : isPos ? "rgba(52,211,153,.3)" : "rgba(248,113,113,.3)"}`,
          }}>
            {isPos ? "+" : ""}{change}%
          </span>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <p style={{ color: "#f1f5f9", fontSize: 30, fontWeight: 800, letterSpacing: "-.03em", lineHeight: 1, margin: 0 }}>
          {fmt(count)}
        </p>
        {sparkline && <Sparkline data={sparkline} color={accent} />}
      </div>

      <div style={{ marginTop: 14, height: 2, borderRadius: 2, background: `linear-gradient(90deg, ${accent}, transparent)`, opacity: .7 }} />
    </div>
  );
}

// ─── Main Application ─────────────────────────────────────────────────────────
export default function App() {
  const [k,   setK]   = useState(null);
  const [f,   setF]   = useState(null);
  const [ch,  setCh]  = useState(null);
  const [c,   setC]   = useState(null);
  const [cat, setCat] = useState(null);
  const [reg, setReg] = useState(null);
  const [ord, setOrd] = useState(null);
  const [err, setErr] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [tab, setTab] = useState("overview");

  const [loadAttempt, setLoadAttempt] = useState(1);
  const [countdown, setCountdown] = useState(5);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setErr(false);

    const maxAttempts = 6;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      setLoadAttempt(attempt);
      try {
        const [a, b, d, e, g, h, i] = await Promise.all([
          get("/api/kpis"),
          get("/api/forecast"),
          get("/api/channels"),
          get("/api/churn"),
          get("/api/categories"),
          get("/api/regions"),
          get("/api/recent-orders"),
        ]);
        setK(a); setF(b); setCh(d); setC(e); setCat(g); setReg(h); setOrd(i);
        setErr(false);
        setLoading(false);
        setRefreshing(false);
        return; // Success!
      } catch (error) {
        if (attempt < maxAttempts) {
          // Wait 1.5 seconds before next attempt to allow backend ML loading
          await new Promise((res) => setTimeout(res, 1500));
        } else {
          console.error("Dashboard failed to fetch backend API after retries:", error);
          setErr(true);
          setCountdown(5);
        }
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData, retryKey]);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Countdown auto-retry when in error state
  useEffect(() => {
    if (!err) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setRetryKey((k) => k + 1);
          return 5;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [err]);

  // ─── Error state ───────────────────────────────────────────────────────────
  if (err) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#020817", padding:20 }}>
      <div style={{
        maxWidth: 500, width: "100%", textAlign: "center",
        background: "rgba(15,23,42,.8)", border: "1px solid rgba(239,68,68,.3)",
        borderRadius: 24, padding: "40px 32px",
        boxShadow: "0 20px 50px rgba(0,0,0,.5), 0 0 30px rgba(239,68,68,.15)",
        backdropFilter: "blur(20px)",
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#f87171", margin: "0 0 10px" }}>Backend Service Offline</h2>
        <p style={{ fontSize: 14, color: "#94a3b8", lineHeight: 1.6, margin: "0 0 20px" }}>
          The FastAPI server is not responding at <code style={{ color: "#a78bfa", background: "rgba(167,139,250,.1)", padding: "2px 6px", borderRadius: 4 }}>http://127.0.0.1:8000</code>.
          Make sure it is started with Python.
        </p>
        <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 24px" }}>
          Auto-reconnecting in <span style={{ color: "#34d399", fontWeight: 700 }}>{countdown}s</span>...
        </p>
        <button
          onClick={() => setRetryKey((prev) => prev + 1)}
          style={{
            background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
            border: "none", color: "#fff",
            padding: "12px 28px", borderRadius: 12,
            fontSize: 14, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 4px 16px rgba(124,58,237,.4)",
            transition: "transform .15s, opacity .15s",
          }}
          onMouseDown={(e) => e.currentTarget.style.transform = "scale(.97)"}
          onMouseUp={(e) => e.currentTarget.style.transform = "scale(1)"}
        >
          Retry Connection Now
        </button>
      </div>
    </div>
  );

  // ─── Loading state ─────────────────────────────────────────────────────────
  if (loading || !k || !f || !ch || !c || !cat || !reg || !ord) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#020817", gap:20 }}>
      <div style={{ width:48, height:48, border:"3px solid rgba(167,139,250,.2)", borderTop:"3px solid #a78bfa", borderRadius:"50%", animation:"spin 1s linear infinite" }} />
      <div style={{ textAlign: "center" }}>
        <p style={{ color:"#e2e8f0", fontSize:14, fontWeight:700, letterSpacing:".08em", margin: "0 0 6px" }}>INITIALIZING AI SALES MODELS...</p>
        <p style={{ color:"#64748b", fontSize:12, margin:0 }}>Connecting to FastAPI server & training predictors {loadAttempt > 1 ? `(attempt ${loadAttempt}/6)` : ""}</p>
      </div>
    </div>
  );

  // ─── Data transforms ───────────────────────────────────────────────────────
  const series = [
    ...f.history.map((d, i) => ({
      date: d.date.slice(5),
      actual: d.revenue,
      // Seamlessly connect history to forecast line at the boundary
      predicted: i === f.history.length - 1 ? d.revenue : undefined,
    })),
    ...f.forecast.map((d) => ({
      date: d.date.slice(5),
      predicted: d.revenue,
      band: [d.lower, d.upper],
    })),
  ];
  const barData  = ch.map((d) => ({ ...d, revenue: Math.round(d.revenue) }));
  const segments = [...c.segments].sort((a, b) => b.revenue - a.revenue);
  const pieData  = cat.map((d, i) => ({ ...d, fill: PIE_COLORS[i % PIE_COLORS.length] }));
  const regData  = reg.map((d) => ({ ...d, revenue: Math.round(d.revenue) }));
  const atRisk   = c.top_at_risk;

  const TABS = [
    { id: "overview",  label: "📊 Overview"  },
    { id: "segments",  label: "👥 Customers" },
    { id: "orders",    label: "🧾 Orders"    },
  ];

  return (
    <div style={{ minHeight:"100vh", background:"#020817", padding:"28px 24px", position:"relative", overflow:"hidden" }}>

      {/* Ambient glowing background orbs */}
      <div aria-hidden style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:0 }}>
        <div style={{ position:"absolute", top:"8%",  left:"12%",  width:540, height:540, borderRadius:"50%", background:"radial-gradient(circle, rgba(139,92,246,.13) 0%, transparent 68%)", animation:"orb1 14s ease-in-out infinite" }} />
        <div style={{ position:"absolute", bottom:"12%", right:"8%", width:600, height:600, borderRadius:"50%", background:"radial-gradient(circle, rgba(6,182,212,.09) 0%, transparent 68%)", animation:"orb2 17s ease-in-out infinite" }} />
        <div style={{ position:"absolute", top:"45%", left:"48%", width:380, height:380, borderRadius:"50%", background:"radial-gradient(circle, rgba(52,211,153,.07) 0%, transparent 68%)", animation:"orb3 20s ease-in-out infinite" }} />
      </div>

      <div style={{ position:"relative", zIndex:1, maxWidth:1400, margin:"0 auto", display:"flex", flexDirection:"column", gap:22 }}>

        {/* Top Header */}
        <header style={{ display:"flex", alignItems:"center", justifyContent:"space-between", animation:"fadeInUp .5s both" }}>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{
              width:44, height:44, borderRadius:14,
              background:"linear-gradient(135deg, #7c3aed, #0891b2)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:20, boxShadow:"0 0 24px rgba(124,58,237,.55), 0 4px 16px rgba(0,0,0,.4)",
              color: "#fff",
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M18 9l-5 5-4-4-3 3" />
              </svg>
            </div>
            <div>
              <h1 style={{ color:"#f1f5f9", fontSize:20, fontWeight:800, margin:0, letterSpacing:"-.03em" }}>Sales Analytics</h1>
              <p style={{ color:"#64748b", fontSize:12, margin:0 }}>AI-powered • Real-time predictive intelligence</p>
            </div>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ textAlign:"right" }}>
              <p style={{ color:"#e2e8f0", fontSize:15, fontWeight:700, margin:0, fontVariantNumeric:"tabular-nums", letterSpacing:"-.01em" }}>
                {clock.toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", second:"2-digit" })}
              </p>
              <p style={{ color:"#64748b", fontSize:11, margin:0 }}>
                {clock.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric", year:"numeric" })}
              </p>
            </div>

            <button
              id="refresh-btn"
              onClick={() => loadData(true)}
              disabled={refreshing}
              title="Refresh Analytics Data"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(15,23,42,.7)", border: "1px solid rgba(148,163,184,.14)",
                borderRadius: 12, padding: "7px 14px",
                color: refreshing ? "#94a3b8" : "#cbd5e1",
                fontSize: 12, fontWeight: 600, cursor: refreshing ? "wait" : "pointer",
                transition: "all .2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(167,139,250,.4)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(148,163,184,.14)"; }}
            >
              <span style={{ display: "inline-block", animation: refreshing ? "spin .8s linear infinite" : "none" }}>↻</span>
              <span>{refreshing ? "Refreshing" : "Refresh"}</span>
            </button>

            <div style={{ display:"flex", alignItems:"center", gap:7, background:"rgba(52,211,153,.1)", border:"1px solid rgba(52,211,153,.28)", borderRadius:20, padding:"6px 14px" }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#34d399", display:"inline-block", animation:"pulse-dot 2s ease-in-out infinite" }} />
              <span style={{ color:"#34d399", fontSize:12, fontWeight:700, letterSpacing:".06em" }}>LIVE</span>
            </div>
          </div>
        </header>

        {/* 5 KPI Metric Cards */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:14 }}>
          {KPI_META.map(({ key, changeKey, label, fmt, accent, glow, delay }) => (
            <KPICard
              key={key}
              label={label}
              value={k[key]}
              fmt={fmt}
              accent={accent}
              glow={glow}
              delay={delay}
              change={k?.changes?.[changeKey]}
              sparkline={k?.sparklines?.[key]}
            />
          ))}
        </div>

        {/* Navigation Tabs */}
        <div style={{ display:"flex", gap:8, animation:"fadeInUp .5s .25s both" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              id={`tab-${t.id}`}
              onClick={() => setTab(t.id)}
              style={{
                padding:"9px 22px", borderRadius:12, border:"none", cursor:"pointer", fontSize:13, fontWeight:600,
                background: tab === t.id ? "rgba(139,92,246,.25)" : "rgba(15,23,42,.6)",
                color: tab === t.id ? "#c4b5fd" : "#64748b",
                boxShadow: tab === t.id ? "0 0 0 1px rgba(139,92,246,.45), 0 4px 12px rgba(124,58,237,.15)" : "0 0 0 1px rgba(148,163,184,.07)",
                transition: "all .2s",
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* ═════════════════ OVERVIEW TAB ═════════════════ */}
        {tab === "overview" && (
          <>
            {/* Revenue Forecast Chart */}
            <Card delay=".28s">
              <SectionHead
                title="30-Day Revenue Forecast"
                sub="Ridge Regression + Gradient-Boosted Residuals • 95% Confidence Interval"
                badge={<Chip label={`WAPE ${(f.wape * 100).toFixed(1)}%`} color="#a78bfa" />}
              />
              <div style={{ display:"flex", gap:20, marginBottom:18 }}>
                {[["#94a3b8","Actual"],["#a78bfa","Predicted"]].map(([col, lbl]) => (
                  <div key={lbl} style={{ display:"flex", alignItems:"center", gap:7 }}>
                    <div style={{ width:22, height:2.5, borderRadius:2, background:col }} />
                    <span style={{ color:"#64748b", fontSize:12 }}>{lbl}</span>
                  </div>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={290}>
                <ComposedChart data={series} margin={{ top:4, right:8, bottom:4, left:8 }}>
                  <defs>
                    <linearGradient id="gBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#7c3aed" stopOpacity={.28} />
                      <stop offset="100%" stopColor="#7c3aed" stopOpacity={.01} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(148,163,184,.05)" />
                  <XAxis dataKey="date" tick={{ fontSize:10, fill:"#64748b" }} minTickGap={42} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={fmtAx} tick={{ fontSize:10, fill:"#64748b" }} axisLine={false} tickLine={false} width={52} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area  dataKey="band"      name="95% Confidence" type="monotone" fill="url(#gBand)" stroke="none"   connectNulls={false} />
                  <Line  dataKey="actual"    name="Actual Revenue"  type="monotone" stroke="#94a3b8"   strokeWidth={1.5} dot={false} />
                  <Line  dataKey="predicted" name="Predicted Revenue" type="monotone" stroke="#a78bfa" strokeWidth={2.5} dot={false} strokeDasharray="6 3" />
                </ComposedChart>
              </ResponsiveContainer>
            </Card>

            {/* Channels & Regions Bar Charts */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
              <Card delay=".4s">
                <SectionHead title="Revenue by Channel" sub="Last 90 days • All sales channels" />
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={barData} barCategoryGap="38%">
                    <defs>
                      {BAR_GRADS.map((col, i) => (
                        <linearGradient key={i} id={`bg${i}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={col} stopOpacity={.9} />
                          <stop offset="100%" stopColor={col} stopOpacity={.35} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid stroke="rgba(148,163,184,.05)" vertical={false} />
                    <XAxis dataKey="channel" tick={{ fontSize:11, fill:"#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize:10, fill:"#64748b" }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill:"rgba(148,163,184,.04)" }} />
                    <Bar dataKey="revenue" radius={[8,8,0,0]} maxBarSize={52} name="Revenue">
                      {barData.map((_, i) => <Cell key={i} fill={`url(#bg${i % BAR_GRADS.length})`} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card delay=".48s">
                <SectionHead title="Revenue by Region" sub="Last 90 days • Geographic breakdown" />
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={regData} layout="vertical" barCategoryGap="30%">
                    <defs>
                      {BAR_GRADS.map((col, i) => (
                        <linearGradient key={i} id={`rg${i}`} x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%"   stopColor={col} stopOpacity={.9} />
                          <stop offset="100%" stopColor={col} stopOpacity={.35} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid stroke="rgba(148,163,184,.05)" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} tick={{ fontSize:10, fill:"#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="region" tick={{ fontSize:11, fill:"#64748b" }} axisLine={false} tickLine={false} width={72} />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill:"rgba(148,163,184,.04)" }} />
                    <Bar dataKey="revenue" radius={[0,8,8,0]} maxBarSize={22} name="Revenue">
                      {regData.map((_, i) => <Cell key={i} fill={`url(#rg${i % BAR_GRADS.length})`} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

            {/* Categories Donut Breakdown */}
            <Card delay=".55s">
              <SectionHead title="Revenue by Product Category" sub="Last 90 days • Market share & sales volume" />
              <div style={{ display:"grid", gridTemplateColumns:"300px 1fr", gap:28, alignItems:"center" }}>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="revenue"
                      nameKey="product_cat"
                      cx="50%" cy="50%"
                      innerRadius={64} outerRadius={108}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip content={<PieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>

                <div style={{ display:"flex", flexDirection:"column", gap:9 }}>
                  {pieData.map((d) => (
                    <div key={d.product_cat} style={{
                      display:"flex", alignItems:"center", justifyContent:"space-between",
                      padding:"10px 14px", borderRadius:12,
                      background:"rgba(15,23,42,.5)", border:`1px solid ${d.fill}22`,
                      transition:"transform .2s, box-shadow .2s",
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.transform="translateX(4px)"; e.currentTarget.style.boxShadow=`0 0 16px ${d.fill}30`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="none"; }}
                    >
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ width:10, height:10, borderRadius:3, background:d.fill, flexShrink:0 }} />
                        <span style={{ color:"#e2e8f0", fontSize:13, fontWeight:600 }}>{d.product_cat}</span>
                        <span style={{ color:"#64748b", fontSize:11 }}>{d.orders} orders</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                        <div style={{ width:72, height:4, borderRadius:4, background:"rgba(148,163,184,.1)", overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${d.share}%`, background:`linear-gradient(90deg, ${d.fill}, ${d.fill}88)`, borderRadius:4 }} />
                        </div>
                        <span style={{ color:d.fill, fontSize:12, fontWeight:700, minWidth:34, textAlign:"right" }}>{d.share}%</span>
                        <span style={{ color:"#94a3b8", fontSize:13, fontWeight:700, minWidth:64, textAlign:"right" }}>{fmt$(d.revenue)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          </>
        )}

        {/* ═════════════════ CUSTOMERS TAB ═════════════════ */}
        {tab === "segments" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>

            {/* Segments RFM */}
            <Card delay=".1s">
              <SectionHead
                title="Customer Segments"
                sub="KMeans RFM Clustering • 4 Segments"
                badge={<Chip label={`ROC-AUC ${c.auc}`} color="#34d399" />}
              />
              <div style={{ display:"flex", flexDirection:"column", gap:11 }}>
                {segments.map((s) => {
                  const m = SEG_COLORS[s.segment] || SEG_COLORS.Lost;
                  return (
                    <div key={s.segment} style={{
                      padding:"14px 16px", borderRadius:14,
                      background: m.bg, border:`1px solid ${m.border}`,
                      transition:"transform .2s, box-shadow .2s",
                    }}
                      onMouseEnter={(e) => { e.currentTarget.style.transform="translateY(-2px)"; e.currentTarget.style.boxShadow=`0 8px 24px ${m.border}`; }}
                      onMouseLeave={(e) => { e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="none"; }}
                    >
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <span style={{
                            padding:"3px 11px", borderRadius:20, fontSize:12, fontWeight:700,
                            background: m.bg, border:`1px solid ${m.border}`, color: m.color,
                          }}>{s.segment}</span>
                          <span style={{ color:"#64748b", fontSize:12 }}>{s.customers} customers</span>
                        </div>
                        <p style={{ color:"#f1f5f9", fontSize:15, fontWeight:700, margin:0 }}>{fmt$(s.revenue)}</p>
                      </div>
                      <div style={{ marginTop:10 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                          <span style={{ color:"#64748b", fontSize:11 }}>Churn risk</span>
                          <span style={{ color:m.color, fontSize:11, fontWeight:700 }}>{(s.avg_churn * 100).toFixed(0)}%</span>
                        </div>
                        <div style={{ height:4, borderRadius:4, background:"rgba(148,163,184,.1)", overflow:"hidden", position:"relative" }}>
                          <div style={{
                            position:"absolute", inset:0,
                            background:`linear-gradient(90deg, transparent, ${m.color}44, transparent)`,
                            animation:"shimmer-bar 2.4s ease-in-out infinite",
                          }} />
                          <div style={{
                            height:"100%", borderRadius:4,
                            width:`${s.avg_churn * 100}%`,
                            background:`linear-gradient(90deg, ${m.color}, ${m.color}88)`,
                            transition:"width 1.2s cubic-bezier(.4,0,.2,1)",
                            position:"relative", zIndex:1,
                          }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* At-risk customers */}
            <Card delay=".2s">
              <SectionHead
                title="Top At-Risk Customers"
                sub="Highest Churn Probability • Random Forest Classifier"
                badge={<Chip label="RF Model" color="#fbbf24" />}
              />
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {atRisk.map((r, i) => (
                  <div key={r.customer_id} style={{
                    display:"flex", alignItems:"center", justifyContent:"space-between",
                    padding:"10px 14px", borderRadius:12,
                    background:"rgba(15,23,42,.6)", border:"1px solid rgba(148,163,184,.07)",
                    transition:"background .2s, border-color .2s",
                    animation:`fadeInUp .35s ${i * .05}s both`,
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.background="rgba(251,191,36,.05)"; e.currentTarget.style.borderColor="rgba(251,191,36,.2)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background="rgba(15,23,42,.6)"; e.currentTarget.style.borderColor="rgba(148,163,184,.07)"; }}
                  >
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <span style={{ color:"#64748b", fontSize:12, fontWeight:700, width:18 }}>#{i+1}</span>
                      <div>
                        <p style={{ color:"#e2e8f0", fontSize:13, fontWeight:600, margin:0 }}>Customer #{r.customer_id}</p>
                        <p style={{ color:"#64748b", fontSize:11, margin:0 }}>{r.recency}d inactive • {fmt$(r.monetary)} LTV</p>
                      </div>
                    </div>
                    <RiskBadge prob={r.churn_prob} />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ═════════════════ ORDERS TAB ═════════════════ */}
        {tab === "orders" && (
          <Card delay=".1s">
            <SectionHead
              title="Recent Orders"
              sub="Latest 10 transactions across all sales channels"
              badge={<Chip label="Live Feed" color="#34d399" />}
            />
            <div style={{ overflowX:"auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
                <thead>
                  <tr>
                    {["Order","Date","Customer","Category","Channel","Region","Amount","Qty"].map((h) => (
                      <th key={h} style={{
                        textAlign:"left", color:"#64748b", fontSize:11, fontWeight:600,
                        textTransform:"uppercase", letterSpacing:".06em",
                        padding:"0 12px 14px", borderBottom:"1px solid rgba(148,163,184,.08)",
                        whiteSpace:"nowrap",
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ord.map((o, i) => (
                    <tr key={o.order_id}
                      style={{ animation:`fadeInUp .35s ${i * .05}s both`, transition:"background .15s" }}
                      onMouseEnter={(e) => { e.currentTarget.style.background="rgba(139,92,246,.06)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background="transparent"; }}
                    >
                      <td style={{ padding:"12px 12px", color:"#64748b", fontVariantNumeric:"tabular-nums", borderBottom:"1px solid rgba(148,163,184,.04)" }}>#{o.order_id}</td>
                      <td style={{ padding:"12px 12px", color:"#94a3b8", borderBottom:"1px solid rgba(148,163,184,.04)", whiteSpace:"nowrap" }}>{o.date?.slice(0,10)}</td>
                      <td style={{ padding:"12px 12px", borderBottom:"1px solid rgba(148,163,184,.04)" }}>
                        <p style={{ color:"#e2e8f0", fontWeight:600, margin:0 }}>{o.name}</p>
                        <p style={{ color:"#64748b", fontSize:11, margin:0 }}>{o.email}</p>
                      </td>
                      <td style={{ padding:"12px 12px", borderBottom:"1px solid rgba(148,163,184,.04)" }}>
                        <span style={{
                          padding:"2px 10px", borderRadius:20, fontSize:11, fontWeight:600,
                          background:"rgba(99,102,241,.15)", color:"#818cf8", border:"1px solid rgba(99,102,241,.25)",
                        }}>{o.product_cat}</span>
                      </td>
                      <td style={{ padding:"12px 12px", color:"#94a3b8", borderBottom:"1px solid rgba(148,163,184,.04)" }}>{o.channel}</td>
                      <td style={{ padding:"12px 12px", color:"#94a3b8", borderBottom:"1px solid rgba(148,163,184,.04)" }}>{o.region}</td>
                      <td style={{ padding:"12px 12px", color:"#34d399", fontWeight:700, fontVariantNumeric:"tabular-nums", borderBottom:"1px solid rgba(148,163,184,.04)" }}>{fmt$(o.amount)}</td>
                      <td style={{ padding:"12px 12px", color:"#60a5fa", fontWeight:600, borderBottom:"1px solid rgba(148,163,184,.04)" }}>{o.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Footer */}
        <footer style={{ textAlign:"center", color:"#475569", fontSize:12, paddingBottom:16, animation:"fadeInUp .6s .6s both" }}>
          Sales Analytics Dashboard • 35k orders • SQLite • FastAPI • React • Recharts
        </footer>

      </div>
    </div>
  );
}
