"use client";

import { motion } from "framer-motion";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const data = [
  { name: "Educational", value: 28, color: "#ef4444" },
  { name: "Knowledge Quiz", value: 18, color: "#ec4899" },
  { name: "Pro Tip", value: 15, color: "#9333ea" },
  { name: "Story / Example", value: 12, color: "#3b82f6" },
  { name: "Myth-Fact", value: 11, color: "#f59e0b" },
  { name: "Carousel", value: 9, color: "#10b981" },
  { name: "Other", value: 7, color: "#6b7280" },
];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      className="rounded-xl px-3 py-2 border border-white/10 text-xs"
      style={{
        background: "rgb(var(--surface-rgb) / 0.98)",
        backdropFilter: "blur(20px)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
      }}
    >
      <p className="font-semibold text-white">{d.name}</p>
      <p className="text-white/50 mt-0.5">{d.value}% of posts</p>
    </div>
  );
};

const RADIAN = Math.PI / 180;
const renderCustomLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: any) => {
  if (percent < 0.08) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="rgba(255,255,255,0.8)"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={10}
      fontWeight={600}
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  );
};

export default function PostTypeChart() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      className="rounded-2xl p-5"
      style={{
        background: "rgb(var(--surface-rgb) / 0.8)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
    >
      <div className="mb-5">
        <h3
          className="text-sm font-semibold text-white"
          style={{ fontFamily: "var(--font-sora), sans-serif" }}
        >
          Content Mix
        </h3>
        <p className="text-xs text-white/40 mt-0.5">Post type distribution</p>
      </div>

      <div className="flex items-center gap-4">
        <div className="w-44 h-44 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={44}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
                labelLine={false}
                label={renderCustomLabel}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={index}
                    fill={entry.color}
                    opacity={0.85}
                    stroke="rgba(0,0,0,0.3)"
                    strokeWidth={1}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="flex-1 space-y-2">
          {data.map((item, i) => (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="flex items-center gap-2"
            >
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: item.color }}
              />
              <span className="text-xs text-white/50 flex-1 truncate">
                {item.name}
              </span>
              <span className="text-xs font-medium text-white/70">
                {item.value}%
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
