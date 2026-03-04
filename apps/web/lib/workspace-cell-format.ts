import { buildFileLink, parseWorkspaceLink } from "./workspace-links";

export type WorkspaceMediaType = "image" | "video" | "audio" | "pdf";

export type WorkspaceLinkType = "url" | "email" | "phone" | "file";

export type FormattedWorkspaceValue = {
	kind: "empty" | "text" | "number" | "currency" | "date" | "link";
	raw: string;
	text: string;
	linkType?: WorkspaceLinkType;
	href?: string;
	filePath?: string;
	mediaType?: WorkspaceMediaType;
	embedUrl?: string;
	numericValue?: number;
	isoDate?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/\S+$/i;
const PHONE_RE = /^\+?[0-9().\-\s]{7,}$/;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
const SLASH_DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const CURRENCY_RE = /^([$\u20ac\u00a3\u00a5])\s*(-?\d[\d,]*(?:\.\d+)?)$/;
const NUMBER_RE = /^-?\d[\d,]*(?:\.\d+)?$/;

const IMAGE_EXTS = new Set([
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"svg",
	"bmp",
	"avif",
	"heic",
	"heif",
	"ico",
	"tiff",
	"tif",
]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "avi", "mkv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);
const PDF_EXTS = new Set(["pdf"]);
const KNOWN_FILE_EXTS = new Set([
	...IMAGE_EXTS,
	...VIDEO_EXTS,
	...AUDIO_EXTS,
	...PDF_EXTS,
	"txt",
	"md",
	"json",
	"yaml",
	"yml",
	"csv",
	"sql",
	"doc",
	"docx",
	"xls",
	"xlsx",
	"ppt",
	"pptx",
	"zip",
	"tar",
	"gz",
]);

function normalizeFieldType(fieldType: string | undefined): string {
	return (fieldType ?? "").trim().toLowerCase();
}

export function toDisplayString(value: unknown): string {
	if (value == null) {return "";}
	if (typeof value === "string") {return value;}
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
		return String(value);
	}
	if (typeof value === "object") {
		try {
			return JSON.stringify(value);
		} catch {
			return "";
		}
	}
	return "";
}

function getExtension(pathLike: string): string {
	const clean = pathLike.split("?")[0]?.split("#")[0] ?? pathLike;
	const ext = clean.split(".").pop()?.toLowerCase() ?? "";
	return ext;
}

export function detectFileMediaType(pathLike: string): WorkspaceMediaType | undefined {
	const ext = getExtension(pathLike);
	if (!ext) {return undefined;}
	if (IMAGE_EXTS.has(ext)) {return "image";}
	if (VIDEO_EXTS.has(ext)) {return "video";}
	if (AUDIO_EXTS.has(ext)) {return "audio";}
	if (PDF_EXTS.has(ext)) {return "pdf";}
	return undefined;
}

function looksLikeAbsoluteFsPath(value: string): boolean {
	return value.startsWith("/") || value.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(value);
}

function decodeFileUrl(value: string): string | null {
	if (!value.startsWith("file://")) {return null;}
	try {
		const url = new URL(value);
		if (url.protocol !== "file:") {return null;}
		const decoded = decodeURIComponent(url.pathname);
		if (/^\/[A-Za-z]:\//.test(decoded)) {
			return decoded.slice(1);
		}
		return decoded;
	} catch {
		return null;
	}
}

function looksLikeFilePath(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) {return false;}
	if (trimmed.includes("://") && !trimmed.startsWith("file://")) {return false;}
	if (trimmed.startsWith("./") || trimmed.startsWith("../") || looksLikeAbsoluteFsPath(trimmed)) {
		return true;
	}
	const hasSlash = trimmed.includes("/") || trimmed.includes("\\");
	const ext = getExtension(trimmed);
	if (hasSlash) {
		return ext.length > 0 && ext.length <= 8;
	}
	return KNOWN_FILE_EXTS.has(ext);
}

function inferFilePath(raw: string): string | null {
	const parsed = parseWorkspaceLink(raw);
	if (parsed?.kind === "file") {
		return parsed.path;
	}

	const fromFileUrl = decodeFileUrl(raw);
	if (fromFileUrl) {
		return fromFileUrl;
	}

	const trimmed = raw.trim();
	if (!looksLikeFilePath(trimmed)) {
		return null;
	}
	return trimmed;
}

function normalizeUrl(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) {return null;}
	if (trimmed.startsWith("www.")) {
		return `https://${trimmed}`;
	}
	if (!URL_RE.test(trimmed)) {
		return null;
	}
	try {
		const u = new URL(trimmed);
		if (u.protocol !== "http:" && u.protocol !== "https:") {
			return null;
		}
		return u.toString();
	} catch {
		return null;
	}
}

function normalizePhone(raw: string): string | null {
	const trimmed = raw.trim();
	if (!PHONE_RE.test(trimmed)) {
		return null;
	}
	const digits = trimmed.replace(/\D/g, "");
	if (digits.length < 7) {
		return null;
	}
	const telTarget = trimmed.replace(/[^\d+]/g, "");
	if (!telTarget) {
		return null;
	}
	return `tel:${telTarget}`;
}

function parseLooseNumber(raw: string): number | null {
	const normalized = raw.replace(/,/g, "").trim();
	if (!normalized) {return null;}
	const parsed = Number(normalized);
	return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat(undefined, {
		maximumFractionDigits: 6,
	}).format(value);
}

function currencyCodeForSymbol(symbol: string): string | null {
	switch (symbol) {
		case "$":
			return "USD";
		case "\u20ac":
			return "EUR";
		case "\u00a3":
			return "GBP";
		case "\u00a5":
			return "JPY";
		default:
			return null;
	}
}

function formatCurrency(symbol: string, amount: number): string {
	const code = currencyCodeForSymbol(symbol);
	if (!code) {
		return `${symbol}${formatNumber(amount)}`;
	}
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: code,
		maximumFractionDigits: 2,
	}).format(amount);
}

function normalizeIsoDateTime(raw: string): string {
	let normalized = raw;
	if (normalized.includes(" ")) {
		normalized = normalized.replace(" ", "T");
	}

	// JS Date only keeps millisecond precision; trim extra fractional digits.
	normalized = normalized.replace(
		/(\.\d{3})\d+(?=(?:Z|[+-]\d{2}(?::?\d{2})?)?$)/,
		"$1",
	);

	// DuckDB can emit short timezone offsets like -08; normalize to -08:00.
	normalized = normalized.replace(/([+-]\d{2})$/, "$1:00");
	// Also normalize compact offsets like +0530 -> +05:30.
	normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

	return normalized;
}

function parseDate(raw: string): Date | null {
	const trimmed = raw.trim();
	if (DATE_ONLY_RE.test(trimmed)) {
		const [y, m, d] = trimmed.split("-").map((part) => Number(part));
		const localDate = new Date(y, (m ?? 1) - 1, d ?? 1);
		return Number.isNaN(localDate.getTime()) ? null : localDate;
	}
	if (!(ISO_DATE_RE.test(trimmed) || SLASH_DATE_RE.test(trimmed))) {
		return null;
	}
	const d = new Date(normalizeIsoDateTime(trimmed));
	if (Number.isNaN(d.getTime())) {
		return null;
	}
	return d;
}

function formatDate(raw: string): { text: string; iso: string } | null {
	const d = parseDate(raw);
	if (!d) {return null;}
	const hasTime = raw.includes("T") || /\d{1,2}:\d{2}/.test(raw);
	const text = hasTime
		? new Intl.DateTimeFormat(undefined, {
			dateStyle: "medium",
			timeStyle: "short",
		}).format(d)
		: new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(d);
	return { text, iso: d.toISOString() };
}

export function buildRawFileUrl(path: string): string {
	if (path.startsWith("http://") || path.startsWith("https://")) {
		return path;
	}
	if (looksLikeAbsoluteFsPath(path)) {
		return `/api/workspace/browse-file?path=${encodeURIComponent(path)}&raw=true`;
	}
	return `/api/workspace/raw-file?path=${encodeURIComponent(path)}`;
}

function formatBySchema(raw: string, fieldType: string): FormattedWorkspaceValue | null {
	if (fieldType === "email" && EMAIL_RE.test(raw.trim())) {
		const email = raw.trim();
		return {
			kind: "link",
			raw,
			text: email,
			linkType: "email",
			href: `mailto:${email}`,
		};
	}
	if (fieldType === "phone") {
		const telHref = normalizePhone(raw);
		if (telHref) {
			return {
				kind: "link",
				raw,
				text: raw.trim(),
				linkType: "phone",
				href: telHref,
			};
		}
	}
	if (fieldType === "url") {
		const href = normalizeUrl(raw);
		if (href) {
			return {
				kind: "link",
				raw,
				text: raw.trim(),
				linkType: "url",
				href,
				mediaType: detectFileMediaType(href),
				embedUrl: href,
			};
		}
	}
	if (fieldType === "date") {
		const formatted = formatDate(raw);
		if (formatted) {
			return {
				kind: "date",
				raw,
				text: formatted.text,
				isoDate: formatted.iso,
			};
		}
	}
	if (fieldType === "number") {
		const currMatch = raw.trim().match(CURRENCY_RE);
		if (currMatch) {
			const amount = parseLooseNumber(currMatch[2] ?? "");
			if (amount != null) {
				return {
					kind: "currency",
					raw,
					text: formatCurrency(currMatch[1] ?? "$", amount),
					numericValue: amount,
				};
			}
		}
		const n = parseLooseNumber(raw);
		if (n != null) {
			return {
				kind: "number",
				raw,
				text: formatNumber(n),
				numericValue: n,
			};
		}
	}
	if (fieldType === "file") {
		const filePath = inferFilePath(raw);
		if (filePath) {
			return {
				kind: "link",
				raw,
				text: filePath,
				linkType: "file",
				href: buildFileLink(filePath),
				filePath,
				mediaType: detectFileMediaType(filePath),
				embedUrl: buildRawFileUrl(filePath),
			};
		}
	}
	return null;
}

function formatByHeuristics(raw: string): FormattedWorkspaceValue {
	const trimmed = raw.trim();

	const filePath = inferFilePath(trimmed);
	if (filePath) {
		return {
			kind: "link",
			raw,
			text: filePath,
			linkType: "file",
			href: buildFileLink(filePath),
			filePath,
			mediaType: detectFileMediaType(filePath),
			embedUrl: buildRawFileUrl(filePath),
		};
	}

	if (EMAIL_RE.test(trimmed)) {
		return {
			kind: "link",
			raw,
			text: trimmed,
			linkType: "email",
			href: `mailto:${trimmed}`,
		};
	}

	const url = normalizeUrl(trimmed);
	if (url) {
		return {
			kind: "link",
			raw,
			text: trimmed,
			linkType: "url",
			href: url,
			mediaType: detectFileMediaType(url),
			embedUrl: url,
		};
	}

	const tel = normalizePhone(trimmed);
	if (tel) {
		return {
			kind: "link",
			raw,
			text: trimmed,
			linkType: "phone",
			href: tel,
		};
	}

	const date = formatDate(trimmed);
	if (date) {
		return {
			kind: "date",
			raw,
			text: date.text,
			isoDate: date.iso,
		};
	}

	const currMatch = trimmed.match(CURRENCY_RE);
	if (currMatch) {
		const amount = parseLooseNumber(currMatch[2] ?? "");
		if (amount != null) {
			return {
				kind: "currency",
				raw,
				text: formatCurrency(currMatch[1] ?? "$", amount),
				numericValue: amount,
			};
		}
	}

	if (NUMBER_RE.test(trimmed)) {
		const n = parseLooseNumber(trimmed);
		if (n != null) {
			return {
				kind: "number",
				raw,
				text: formatNumber(n),
				numericValue: n,
			};
		}
	}

	return {
		kind: "text",
		raw,
		text: raw,
	};
}

export function formatWorkspaceFieldValue(
	value: unknown,
	fieldType?: string,
): FormattedWorkspaceValue {
	const raw = toDisplayString(value);
	if (!raw || raw.trim().length === 0) {
		return { kind: "empty", raw, text: "" };
	}

	const schemaType = normalizeFieldType(fieldType);
	const schemaFormatted = formatBySchema(raw, schemaType);
	if (schemaFormatted) {
		return schemaFormatted;
	}

	// Limit heuristic formatting on rich text / relation-like fields.
	if (schemaType === "richtext" || schemaType === "relation" || schemaType === "enum" || schemaType === "user") {
		return {
			kind: "text",
			raw,
			text: raw,
		};
	}

	return formatByHeuristics(raw);
}
