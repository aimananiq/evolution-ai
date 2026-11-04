import { describe, it, expect } from "vitest";
import { isPrivateIp, assertPublicUrl } from "./ssrf";

describe("isPrivateIp", () => {
  it("flags loopback, RFC1918, link-local, CGNAT, ULA", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
      "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fd00::1", "fc00::1"]) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "100.63.0.1", "2606:4700::1"]) {
      expect(isPrivateIp(ip), ip).toBe(false);
    }
  });
  it("catches IPv4-mapped IPv6 metadata bypass", () => {
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true);
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true);
  });
  it("rejects unparseable input", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    expect((await assertPublicUrl("file:///etc/passwd")).ok).toBe(false);
    expect((await assertPublicUrl("gopher://x/")).ok).toBe(false);
  });
  it("rejects literal internal IPs", async () => {
    expect((await assertPublicUrl("http://127.0.0.1:9000/")).ok).toBe(false);
    expect((await assertPublicUrl("http://169.254.169.254/latest/meta-data")).ok).toBe(false);
    expect((await assertPublicUrl("http://[::ffff:169.254.169.254]/")).ok).toBe(false);
    expect((await assertPublicUrl("http://10.0.0.5/")).ok).toBe(false);
  });
  it("rejects internal docker service hostnames (resolve failure or private)", async () => {
    // Unknown hostname → dns failure → rejected (fails closed).
    expect((await assertPublicUrl("http://definitely-not-a-real-host-xyz123.internal/")).ok).toBe(false);
  });
  it("honours the allowHosts escape hatch without resolving", async () => {
    expect((await assertPublicUrl("http://ollama.lan:11434/", ["ollama.lan"])).ok).toBe(true);
  });
  it("rejects malformed URLs", async () => {
    expect((await assertPublicUrl("http://")).ok).toBe(false);
    expect((await assertPublicUrl("nonsense")).ok).toBe(false);
  });
});
