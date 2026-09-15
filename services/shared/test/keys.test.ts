import { describe, it, expect } from "vitest";
import { objectKey } from "../src/keys.js";

describe("objectKey (Rule 6)", () => {
  it("builds users/<user_id>/<file_id>", () => {
    expect(objectKey("u1", "f1")).toBe("users/u1/f1");
  });

  it("contains no part of the creator-supplied filename", () => {
    const originalName = "Kick_G#_128.wav";
    const fileId = "01J8Z9QK3M4N5P6R7S8T9V0WXY";
    const key = objectKey("u1", fileId);

    expect(key).toBe("users/u1/" + fileId);
    for (const fragment of ["Kick", "kick", "G#", "128", "wav", ".wav", "_"]) {
      expect(key.includes(fragment)).toBe(false);
    }
    expect(key.toLowerCase().includes(originalName.toLowerCase())).toBe(false);
  });

  it("has exactly two structural slashes and no others", () => {
    const key = objectKey("01J8USER", "01J8FILE");
    expect((key.match(/\//g) ?? []).length).toBe(2);
    expect(key.split("/")).toEqual(["users", "01J8USER", "01J8FILE"]);
  });

  it("rejects ids that would smuggle extra path segments", () => {
    expect(() => objectKey("u1", "a/b")).toThrow();
    expect(() => objectKey("u1/../u2", "f1")).toThrow();
    expect(() => objectKey("", "f1")).toThrow();
    expect(() => objectKey("u1", "")).toThrow();
  });
});
