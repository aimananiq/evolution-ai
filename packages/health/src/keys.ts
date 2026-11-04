export function utcDateStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function bulkSendKey(instanceId: string, d: Date): string {
  return `health:bulk:${instanceId}:${utcDateStamp(d)}`;
}
