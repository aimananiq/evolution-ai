export function buildWaLink(phone: string, message = ""): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) throw new Error("phone required");
  const base = `https://wa.me/${digits}`;
  return message ? `${base}?text=${encodeURIComponent(message)}` : base;
}
