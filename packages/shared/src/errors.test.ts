import { describe, it, expect } from "vitest";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "./errors";

describe("AppError", () => {
  it("carries a code and an http status", () => {
    const e = new AppError("oops", { code: "OOPS", status: 418 });
    expect(e.code).toBe("OOPS");
    expect(e.status).toBe(418);
    expect(e.message).toBe("oops");
  });

  it("ForbiddenError defaults to 403", () => {
    expect(new ForbiddenError("nope").status).toBe(403);
  });

  it("NotFoundError defaults to 404", () => {
    expect(new NotFoundError("gone").status).toBe(404);
  });

  it("ValidationError defaults to 400 and carries field issues", () => {
    const e = new ValidationError("bad", { issues: [{ field: "email", message: "required" }] });
    expect(e.status).toBe(400);
    expect(e.issues).toEqual([{ field: "email", message: "required" }]);
  });
});
