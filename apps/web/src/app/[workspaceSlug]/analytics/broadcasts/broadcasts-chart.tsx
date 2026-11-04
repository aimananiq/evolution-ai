"use client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { Card } from "@/components/ui/card";

export default function BroadcastsChart({ data }: { data: { status: string; count: number }[] }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Broadcast funnel</h1>
      <Card className="p-3 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="status" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#000" />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
