"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function ActivityChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(168 100% 33%)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="hsl(168 100% 33%)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(197 11% 58% / 0.15)" strokeDasharray="3 3" />
        <XAxis dataKey="label" stroke="hsl(197 11% 58%)" fontSize={12} tickLine={false} axisLine={false} dy={4} />
        <YAxis stroke="hsl(197 11% 58%)" fontSize={12} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 10,
            color: "hsl(var(--popover-foreground))",
            fontSize: 12,
            boxShadow: "0 4px 12px rgb(0 0 0 / 0.12)",
          }}
          labelStyle={{ color: "hsl(var(--muted-foreground))" }}
          cursor={{ stroke: "hsl(197 11% 58% / 0.35)" }}
        />
        <Area type="monotone" dataKey="value" stroke="hsl(168 100% 33%)" strokeWidth={2} fill="url(#fill)" dot={false} activeDot={{ r: 4 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
