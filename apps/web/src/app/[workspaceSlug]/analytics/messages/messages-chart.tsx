"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, CartesianGrid, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";

export default function MessagesChart({ data }: { data: { date: string; inbound: number; outbound: number }[] }) {
  if (data.length === 0) return <p className="text-muted-foreground text-sm">No data yet</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Messages — last 30 days</h1>
      <Card className="p-3 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line dataKey="inbound" stroke="#3b82f6" />
            <Line dataKey="outbound" stroke="#000" />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
