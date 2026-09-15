import { describe, it, expect } from "vitest";
import { validateRelativePath } from "../src/paths.js";

const NUL = String.fromCharCode(0);

describe("validateRelativePath - rejections", () => {
  it("rejects parent traversal ../etc/passwd", () => {
    expect(() => validateRelativePath("../etc/passwd")).toThrow();
  });

  it("rejects an absolute path /absolute/path", () => {
    expect(() => validateRelativePath("/absolute/path")).toThrow();
  });

  it("rejects embedded traversal a/../../b", () => {
    expect(() => validateRelativePath("a/../../b")).toThrow();
  });

  it("rejects a string containing a NUL byte", () => {
    expect(() => validateRelativePath("Kicks/bad" + NUL + "name.wav")).toThrow();
  });

  it("rejects a path over 1024 chars", () => {
    const long = "a".repeat(200) + "/" + "b".repeat(200);
    const path = Array.from({ length: 4 }, () => long).join("/");
    expect(path.length).toBeGreaterThan(1024);
    expect(() => validateRelativePath(path)).toThrow();
  });

  it("rejects any single segment over 255 chars", () => {
    const path = "Samples/" + "x".repeat(256) + "/kick.wav";
    expect(path.length).toBeLessThanOrEqual(1024);
    expect(() => validateRelativePath(path)).toThrow();
  });

  it("rejects an empty path", () => {
    expect(() => validateRelativePath("")).toThrow();
  });

  it("throws a 400 badRequest HttpError", () => {
    try {
      validateRelativePath("../etc/passwd");
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as { status?: number }).status).toBe(400);
    }
  });
});

// Built from code points so the source file stays ASCII-portable.
const CJK_EMOJI_PATH =
  String.fromCodePoint(0x30b5, 0x30f3, 0x30d7, 0x30eb, 0x96c6) +
  "/" +
  String.fromCodePoint(0x97f3, 0x6e90) +
  " " +
  String.fromCodePoint(0x1f3a7) +
  "/" +
  String.fromCodePoint(0x30ad, 0x30c3, 0x30af) +
  String.fromCodePoint(0x1f600) +
  ".wav";

const COMBINING_ACUTE = String.fromCodePoint(0x0301);

describe("validateRelativePath - acceptance, byte-identical (Rule 1)", () => {
  it("accepts KSHMR Vol 5/Kicks/Kick_G#_128.wav and returns it byte-identical", () => {
    const input = "KSHMR Vol 5/Kicks/Kick_G#_128.wav";
    const out = validateRelativePath(input);
    expect(out).toBe(input);
    expect(Buffer.from(out, "utf8").equals(Buffer.from(input, "utf8"))).toBe(true);
  });

  it("accepts a unicode path (CJK + emoji) and returns it byte-identical", () => {
    const input = CJK_EMOJI_PATH;
    const out = validateRelativePath(input);
    expect(out).toBe(input);
    expect(Buffer.from(out, "utf8").equals(Buffer.from(input, "utf8"))).toBe(true);
    expect(Buffer.from(out, "utf8").length).toBeGreaterThan(out.length);
  });

  it("does not normalize, trim, lower-case or rewrite the input (Rule 1)", () => {
    const input = "  Mixed CASE Folder  /Sub Folder/File Name .WAV";
    const out = validateRelativePath(input);
    expect(out).toBe(input);
    expect(out).not.toBe(input.trim());
    expect(out).not.toBe(input.toLowerCase());
    expect(Buffer.from(out, "utf8").equals(Buffer.from(input, "utf8"))).toBe(true);
  });

  it("preserves decomposed (NFD) unicode form exactly - no normalization", () => {
    const nfd = "Cafe" + COMBINING_ACUTE + "/kick.wav";
    const out = validateRelativePath(nfd);
    expect(out).toBe(nfd);
    expect(out).not.toBe(nfd.normalize("NFC"));
  });

  it("accepts a single-segment path", () => {
    expect(validateRelativePath("kick.wav")).toBe("kick.wav");
  });
});
