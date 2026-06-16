"use client";

import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

const data = [
  { day: "Mon", likes: 420, comments: 89, saves: 134, reach: 3200 },
  { day: "Tue", likes: 380, comments: 72, saves: 98, reach: 2800 },
  { day: "Wed", likes: 650, comments: 145, saves: 210, reach: 5100 },
  { day: "Thu", likes: 520, comments: 103, saves: 167, reach: 4200 },
  { day: "Fri", likes: 890, comments: 198, saves: 312, reach: 7400 },
  { day: "Sat", likes: 740, comments: 156, saves: 245, reach: 6100 },
  { day: "Sun", likes: 610, comments: 122, saves: 189, reach: 5000 },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-4 py-3 border border-white/10 text-sm"
      style={{
        background: "rgba(17,17,24,0.98)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
      }}
    >
      <p
        className="font-semibold text-white mb-2"
        style={{ fontFamily: "Sora, sans-serif" }}
      >
        {label}
      </p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2 mb-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: entry.color }}
          />
          <span className="text-white/50 capitalize">{entry.name}:</span>
          <span className="text-white font-medium">
            {entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function EngagementChart() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
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
            Engagement Overview
          </h3>
          <p className="text-xs text-white/40 mt-0.5">Last 7 days</p>
        </div>
        <div className="flex gap-2">
          {["7D", "30D", "90D"].map((t) => (
            <button
              key={t}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                t === "7D"
                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                  : "text-white/30 hover:text-white/60"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="likesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="commentsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ec4899" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ec4899" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="savesGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#9333ea" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#9333ea" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.04)"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="likes"
              stroke="#ef4444"
              strokeWidth={2}
              fill="url(#likesGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#ef4444", strokeWidth: 0 }}
            />
            <Area
              type="monotone"
              dataKey="comments"
              stroke="#ec4899"
              strokeWidth={2}
              fill="url(#commentsGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#ec4899", strokeWidth: 0 }}
            />
            <Area
              type="monotone"
              dataKey="saves"
              stroke="#9333ea"
              strokeWidth={2}
              fill="url(#savesGrad)"
              dot={false}
              activeDot={{ r: 4, fill: "#9333ea", strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center gap-5 mt-4">
        {[
          { label: "Likes", color: "#ef4444", value: "4,210" },
          { label: "Comments", color: "#ec4899", value: "885" },
          { label: "Saves", color: "#9333ea", value: "1,355" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full"
              style={{ background: item.color, boxShadow: `0 0 8px ${item.color}` }}
            />
            <span className="text-xs text-white/40">{item.label}:</span>
            <span className="text-xs font-medium text-white/70">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
