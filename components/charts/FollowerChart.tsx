"use client";

import { motion } from "framer-motion";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

const data = [
  { date: "May 1", followers: 18400 },
  { date: "May 2", followers: 18520 },
  { date: "May 3", followers: 18600 },
  { date: "May 4", followers: 18750 },
  { date: "May 5", followers: 18900 },
  { date: "May 6", followers: 18820 },
  { date: "May 7", followers: 19100 },
  { date: "May 8", followers: 19350 },
  { date: "May 9", followers: 19200 },
  { date: "May 10", followers: 19500 },
  { date: "May 11", followers: 19800 },
  { date: "May 12", followers: 20100 },
  { date: "May 13", followers: 20400 },
  { date: "May 14", followers: 20800 },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const value = payload[0].value;
  return (
    <div
      className="rounded-xl px-4 py-3 border border-white/10 text-sm"
      style={{
        background: "rgba(17,17,24,0.98)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
      }}
    >
      <p className="text-white/50 text-xs mb-1">{label}</p>
      <p
        className="text-white font-bold text-base"
        style={{ fontFamily: "Sora, sans-serif" }}
      >
        {value.toLocaleString()}
        <span className="text-xs font-normal text-white/40 ml-1">followers</span>
      </p>
    </div>
  );
};

export default function FollowerChart() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35 }}
      className="rounded-2xl p-5"
      style={{
        background: "rgba(17,17,24,0.8)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3
            className="text-sm font-semibold text-white"
            style={{ fontFamily: "Sora, sans-serif" }}
          >
            Follower Growth
          </h3>
          <p className="text-xs text-white/40 mt-0.5">Last 14 days</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-xs font-semibold text-emerald-400">
            +2,400 this month
          </span>
        </div>
      </div>

      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ef4444" />
                <stop offset="50%" stopColor="#ec4899" />
                <stop offset="100%" stopColor="#9333ea" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.04)"
              vertical={false}
            />
            <XAxis
              dataKey="date"
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              interval={2}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
              domain={["dataMin - 500", "dataMax + 200"]}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="followers"
              stroke="url(#lineGlow)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{
                r: 5,
                fill: "#ec4899",
                stroke: "rgba(236,72,153,0.4)",
                strokeWidth: 4,
              }}
              filter="url(#glow)"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/[0.05]">
        {[
          { label: "Gained", value: "+2,400", color: "text-emerald-400" },
          { label: "Lost", value: "-187", color: "text-red-400" },
          { label: "Net", value: "+2,213", color: "text-white" },
        ].map((item) => (
          <div key={item.label} className="text-center">
            <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
            <p className="text-[10px] text-white/30 mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
