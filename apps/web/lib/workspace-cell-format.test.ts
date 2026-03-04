import { describe, expect, it } from "vitest";
import {
	buildRawFileUrl,
	detectFileMediaType,
	formatWorkspaceFieldValue,
} from "./workspace-cell-format";

describe("formatWorkspaceFieldValue", () => {
	it("returns empty kind for nullish/blank values (prevents noisy placeholders)", () => {
		expect(formatWorkspaceFieldValue(null, "text")).toEqual({
			kind: "empty",
			raw: "",
			text: "",
		});
		expect(formatWorkspaceFieldValue("   ", "text")).toEqual({
			kind: "empty",
			raw: "   ",
			text: "",
		});
	});

	it("formats schema email as clickable mailto link", () => {
		const result = formatWorkspaceFieldValue("hello@example.com", "email");
		expect(result.kind).toBe("link");
		expect(result.linkType).toBe("email");
		expect(result.href).toBe("mailto:hello@example.com");
	});

	it("formats schema phone as clickable tel link", () => {
		const result = formatWorkspaceFieldValue("+1 (555) 123-4567", "phone");
		expect(result.kind).toBe("link");
		expect(result.linkType).toBe("phone");
		expect(result.href).toBe("tel:+15551234567");
	});

	it("formats schema date into a normalized date payload", () => {
		const result = formatWorkspaceFieldValue("2026-03-03", "date");
		expect(result.kind).toBe("date");
		expect(result.isoDate).toBeTruthy();
		expect(result.text.length).toBeGreaterThan(0);
	});

	it("formats DuckDB timestamps with microseconds and short timezone offsets", () => {
		const raw = "2026-03-03 19:27:02.880576-08";
		const result = formatWorkspaceFieldValue(raw, "date");
		expect(result.kind).toBe("date");
		expect(result.isoDate).toBe("2026-03-04T03:27:02.880Z");
		expect(result.text).not.toBe(raw);
	});

	it("formats schema number with dollar prefix as currency", () => {
		const result = formatWorkspaceFieldValue("$1,234.50", "number");
		expect(result.kind).toBe("currency");
		expect(result.numericValue).toBe(1234.5);
	});

	it("falls back to URL heuristics for text fields", () => {
		const result = formatWorkspaceFieldValue("www.example.com", "text");
		expect(result.kind).toBe("link");
		expect(result.linkType).toBe("url");
		expect(result.href).toBe("https://www.example.com");
	});

	it("identifies workspace file links and includes embed metadata", () => {
		const result = formatWorkspaceFieldValue("/workspace?path=docs%2Fdeck.pdf", "text");
		expect(result.kind).toBe("link");
		expect(result.linkType).toBe("file");
		expect(result.filePath).toBe("docs/deck.pdf");
		expect(result.href).toContain("/workspace?path=");
		expect(result.mediaType).toBe("pdf");
		expect(result.embedUrl).toBe("/api/workspace/raw-file?path=docs%2Fdeck.pdf");
	});

	it("identifies local absolute paths and routes embed URL via browse-file API", () => {
		const result = formatWorkspaceFieldValue("/Users/me/Desktop/photo.png", "text");
		expect(result.kind).toBe("link");
		expect(result.linkType).toBe("file");
		expect(result.embedUrl).toBe(
			"/api/workspace/browse-file?path=%2FUsers%2Fme%2FDesktop%2Fphoto.png&raw=true",
		);
	});

	it("avoids over-formatting richtext fields with link heuristics", () => {
		const result = formatWorkspaceFieldValue("https://example.com", "richtext");
		expect(result.kind).toBe("text");
		expect(result.text).toBe("https://example.com");
	});
});

describe("detectFileMediaType", () => {
	it("classifies media extensions used by embeds", () => {
		expect(detectFileMediaType("demo.png")).toBe("image");
		expect(detectFileMediaType("demo.mp4")).toBe("video");
		expect(detectFileMediaType("demo.mp3")).toBe("audio");
		expect(detectFileMediaType("demo.pdf")).toBe("pdf");
		expect(detectFileMediaType("demo.txt")).toBeUndefined();
	});
});

describe("buildRawFileUrl", () => {
	it("maps relative and absolute paths to the correct file APIs", () => {
		expect(buildRawFileUrl("notes/today.md")).toBe("/api/workspace/raw-file?path=notes%2Ftoday.md");
		expect(buildRawFileUrl("/Users/me/file.txt")).toBe(
			"/api/workspace/browse-file?path=%2FUsers%2Fme%2Ffile.txt&raw=true",
		);
		expect(buildRawFileUrl("https://cdn.example.com/image.png")).toBe(
			"https://cdn.example.com/image.png",
		);
	});
});
