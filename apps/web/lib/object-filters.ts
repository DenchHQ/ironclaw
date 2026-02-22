/**
 * Object view filter system.
 *
 * Provides a composable filter model for workspace object entries,
 * a client-side evaluator (`matchesFilter`), a DuckDB SQL builder
 * (`buildWhereClause`), and operator metadata per field type.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FilterOperator =
	// text / url / richtext
	| "contains"
	| "not_contains"
	| "equals"
	| "not_equals"
	| "starts_with"
	| "ends_with"
	// number
	| "eq"
	| "neq"
	| "gt"
	| "gte"
	| "lt"
	| "lte"
	| "between"
	// date
	| "before"
	| "after"
	| "on"
	| "date_between"
	| "relative_past"
	| "relative_next"
	// enum
	| "is"
	| "is_not"
	| "is_any_of"
	| "is_none_of"
	// boolean
	| "is_true"
	| "is_false"
	// relation
	| "has_any"
	| "has_none"
	| "has_all"
	// universal
	| "is_empty"
	| "is_not_empty";

export type FilterRule = {
	id: string;
	field: string;
	operator: FilterOperator;
	value?: string | number | boolean | string[];
	/** Upper bound for "between" / "date_between". */
	valueTo?: string | number;
	/** Unit for relative date operators. */
	relativeUnit?: "days" | "weeks" | "months";
	/** Amount for relative date operators. */
	relativeAmount?: number;
};

export type FilterGroup = {
	id: string;
	conjunction: "and" | "or";
	rules: Array<FilterRule | FilterGroup>;
};

export type SortRule = {
	field: string;
	direction: "asc" | "desc";
};

export type SavedView = {
	name: string;
	filters?: FilterGroup;
	sort?: SortRule[];
	columns?: string[];
};

/** Minimal field descriptor needed by the filter system. */
export type FieldMeta = {
	name: string;
	type: string; // "text" | "number" | "date" | "boolean" | "enum" | "relation" | "richtext" | "email" | "user"
};

// ---------------------------------------------------------------------------
// Operator metadata per field type
// ---------------------------------------------------------------------------

type OperatorMeta = { value: FilterOperator; label: string };

const UNIVERSAL_OPS: OperatorMeta[] = [
	{ value: "is_empty", label: "is empty" },
	{ value: "is_not_empty", label: "is not empty" },
];

const TEXT_OPS: OperatorMeta[] = [
	{ value: "contains", label: "contains" },
	{ value: "not_contains", label: "does not contain" },
	{ value: "equals", label: "equals" },
	{ value: "not_equals", label: "does not equal" },
	{ value: "starts_with", label: "starts with" },
	{ value: "ends_with", label: "ends with" },
	...UNIVERSAL_OPS,
];

const NUMBER_OPS: OperatorMeta[] = [
	{ value: "eq", label: "=" },
	{ value: "neq", label: "≠" },
	{ value: "gt", label: ">" },
	{ value: "gte", label: "≥" },
	{ value: "lt", label: "<" },
	{ value: "lte", label: "≤" },
	{ value: "between", label: "between" },
	...UNIVERSAL_OPS,
];

const DATE_OPS: OperatorMeta[] = [
	{ value: "on", label: "is" },
	{ value: "before", label: "before" },
	{ value: "after", label: "after" },
	{ value: "date_between", label: "between" },
	{ value: "relative_past", label: "in the last" },
	{ value: "relative_next", label: "in the next" },
	...UNIVERSAL_OPS,
];

const ENUM_OPS: OperatorMeta[] = [
	{ value: "is", label: "is" },
	{ value: "is_not", label: "is not" },
	{ value: "is_any_of", label: "is any of" },
	{ value: "is_none_of", label: "is none of" },
	...UNIVERSAL_OPS,
];

const BOOLEAN_OPS: OperatorMeta[] = [
	{ value: "is_true", label: "is true" },
	{ value: "is_false", label: "is false" },
	...UNIVERSAL_OPS,
];

const RELATION_OPS: OperatorMeta[] = [
	{ value: "has_any", label: "has any of" },
	{ value: "has_none", label: "has none of" },
	{ value: "has_all", label: "has all of" },
	...UNIVERSAL_OPS,
];

/**
 * Return the operators valid for a given field type.
 */
export function operatorsForFieldType(fieldType: string): OperatorMeta[] {
	switch (fieldType) {
		case "text":
		case "richtext":
		case "email":
			return TEXT_OPS;
		case "number":
			return NUMBER_OPS;
		case "date":
			return DATE_OPS;
		case "enum":
			return ENUM_OPS;
		case "boolean":
			return BOOLEAN_OPS;
		case "relation":
		case "user":
			return RELATION_OPS;
		default:
			return TEXT_OPS;
	}
}

/**
 * Return the default operator for a given field type.
 */
export function defaultOperatorForFieldType(fieldType: string): FilterOperator {
	switch (fieldType) {
		case "text":
		case "richtext":
		case "email":
			return "contains";
		case "number":
			return "eq";
		case "date":
			return "relative_past";
		case "enum":
			return "is";
		case "boolean":
			return "is_true";
		case "relation":
		case "user":
			return "has_any";
		default:
			return "contains";
	}
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

export function isFilterGroup(
	rule: FilterRule | FilterGroup,
): rule is FilterGroup {
	return "conjunction" in rule && "rules" in rule;
}

// ---------------------------------------------------------------------------
// Client-side evaluator
// ---------------------------------------------------------------------------

function coerceString(v: unknown): string {
	if (v == null) {return "";}
	if (typeof v === "string") {return v;}
	if (typeof v === "object") {return JSON.stringify(v);}
	return typeof v === "symbol" || typeof v === "function" ? "" : String(v as string | number | boolean | bigint);
}

function coerceNumber(v: unknown): number | null {
	if (v == null) {return null;}
	const n = Number(v);
	return Number.isNaN(n) ? null : n;
}

function parseRelationIds(v: unknown): string[] {
	if (v == null) {return [];}
	const s = coerceString(v).trim();
	if (!s) {return [];}
	if (s.startsWith("[")) {
		try {
			const arr = JSON.parse(s);
			if (Array.isArray(arr)) {return arr.map(String).filter(Boolean);}
		} catch {
			/* not JSON */
		}
	}
	return [s];
}

function resolveRelativeDate(amount: number, unit: string, direction: "past" | "next"): Date {
	const now = new Date();
	const mult = direction === "past" ? -1 : 1;
	switch (unit) {
		case "days":
			now.setDate(now.getDate() + mult * amount);
			break;
		case "weeks":
			now.setDate(now.getDate() + mult * amount * 7);
			break;
		case "months":
			now.setMonth(now.getMonth() + mult * amount);
			break;
	}
	return now;
}

function dateOnly(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Evaluate a single FilterRule against one entry row.
 */
function evaluateRule(
	rule: FilterRule,
	entry: Record<string, unknown>,
): boolean {
	const raw = entry[rule.field];
	const op = rule.operator;

	// Universal operators
	if (op === "is_empty") {
		const s = coerceString(raw).trim();
		return s === "" || s === "null" || s === "[]";
	}
	if (op === "is_not_empty") {
		const s = coerceString(raw).trim();
		return s !== "" && s !== "null" && s !== "[]";
	}

	// Boolean operators
	if (op === "is_true") {
		const s = coerceString(raw).toLowerCase();
		return s === "true" || s === "1" || s === "yes";
	}
	if (op === "is_false") {
		const s = coerceString(raw).toLowerCase();
		return s === "false" || s === "0" || s === "no" || s === "";
	}

	// Text operators
	if (
		op === "contains" ||
		op === "not_contains" ||
		op === "equals" ||
		op === "not_equals" ||
		op === "starts_with" ||
		op === "ends_with"
	) {
		const haystack = coerceString(raw).toLowerCase();
		const needle = coerceString(rule.value).toLowerCase();
		switch (op) {
			case "contains":
				return haystack.includes(needle);
			case "not_contains":
				return !haystack.includes(needle);
			case "equals":
				return haystack === needle;
			case "not_equals":
				return haystack !== needle;
			case "starts_with":
				return haystack.startsWith(needle);
			case "ends_with":
				return haystack.endsWith(needle);
		}
	}

	// Number operators
	if (
		op === "eq" ||
		op === "neq" ||
		op === "gt" ||
		op === "gte" ||
		op === "lt" ||
		op === "lte" ||
		op === "between"
	) {
		const n = coerceNumber(raw);
		if (n == null) {return false;}
		const v = coerceNumber(rule.value);
		if (v == null && op !== "between") {return false;}
		switch (op) {
			case "eq":
				return n === v;
			case "neq":
				return n !== v;
			case "gt":
				return n > v!;
			case "gte":
				return n >= v!;
			case "lt":
				return n < v!;
			case "lte":
				return n <= v!;
			case "between": {
				const lo = coerceNumber(rule.value);
				const hi = coerceNumber(rule.valueTo);
				if (lo == null || hi == null) {return false;}
				return n >= lo && n <= hi;
			}
		}
	}

	// Date operators
	if (
		op === "on" ||
		op === "before" ||
		op === "after" ||
		op === "date_between" ||
		op === "relative_past" ||
		op === "relative_next"
	) {
		const dateStr = coerceString(raw).slice(0, 10); // YYYY-MM-DD
		if (!dateStr) {return false;}

		if (op === "relative_past") {
			const amount = rule.relativeAmount ?? 7;
			const unit = rule.relativeUnit ?? "days";
			const boundary = dateOnly(resolveRelativeDate(amount, unit, "past"));
			const today = dateOnly(new Date());
			return dateStr >= boundary && dateStr <= today;
		}
		if (op === "relative_next") {
			const amount = rule.relativeAmount ?? 7;
			const unit = rule.relativeUnit ?? "days";
			const boundary = dateOnly(resolveRelativeDate(amount, unit, "next"));
			const today = dateOnly(new Date());
			return dateStr >= today && dateStr <= boundary;
		}

		const target = coerceString(rule.value === "today" ? dateOnly(new Date()) : rule.value);
		switch (op) {
			case "on":
				return dateStr === target;
			case "before":
				return dateStr < target;
			case "after":
				return dateStr > target;
			case "date_between": {
				const from = coerceString(rule.value);
				const to = coerceString(rule.valueTo);
				return dateStr >= from && dateStr <= to;
			}
		}
	}

	// Enum operators
	if (op === "is" || op === "is_not" || op === "is_any_of" || op === "is_none_of") {
		const cellVal = coerceString(raw);
		// For multi-select enums the cell may be a JSON array
		let cellValues: string[];
		try {
			const parsed = JSON.parse(cellVal);
			cellValues = Array.isArray(parsed) ? parsed.map(String) : [cellVal];
		} catch {
			cellValues = [cellVal];
		}

		switch (op) {
			case "is":
				return cellValues.includes(coerceString(rule.value));
			case "is_not":
				return !cellValues.includes(coerceString(rule.value));
			case "is_any_of": {
				const vals = Array.isArray(rule.value) ? rule.value.map(String) : [coerceString(rule.value)];
				return cellValues.some((cv) => vals.includes(cv));
			}
			case "is_none_of": {
				const vals = Array.isArray(rule.value) ? rule.value.map(String) : [coerceString(rule.value)];
				return !cellValues.some((cv) => vals.includes(cv));
			}
		}
	}

	// Relation / user operators
	if (op === "has_any" || op === "has_none" || op === "has_all") {
		const ids = parseRelationIds(raw);
		const targets = Array.isArray(rule.value) ? rule.value.map(String) : [coerceString(rule.value)];
		switch (op) {
			case "has_any":
				return ids.some((id) => targets.includes(id));
			case "has_none":
				return !ids.some((id) => targets.includes(id));
			case "has_all":
				return targets.every((t) => ids.includes(t));
		}
	}

	return true;
}

/**
 * Evaluate a FilterGroup (with nested groups) against one entry.
 */
function evaluateGroup(
	group: FilterGroup,
	entry: Record<string, unknown>,
): boolean {
	const results = group.rules.map((rule) =>
		isFilterGroup(rule)
			? evaluateGroup(rule, entry)
			: evaluateRule(rule, entry),
	);

	return group.conjunction === "and"
		? results.every(Boolean)
		: results.some(Boolean);
}

/**
 * Filter an array of entries client-side using a FilterGroup.
 * Returns entries that match the filter.
 */
export function matchesFilter(
	entries: Record<string, unknown>[],
	filters: FilterGroup | undefined,
): Record<string, unknown>[] {
	if (!filters || filters.rules.length === 0) {return entries;}
	return entries.filter((entry) => evaluateGroup(filters, entry));
}

/**
 * Test a single entry against a FilterGroup.
 */
export function entryMatchesFilter(
	entry: Record<string, unknown>,
	filters: FilterGroup | undefined,
): boolean {
	if (!filters || filters.rules.length === 0) {return true;}
	return evaluateGroup(filters, entry);
}

// ---------------------------------------------------------------------------
// DuckDB SQL WHERE clause builder
// ---------------------------------------------------------------------------

/**
 * Escape a string value for use in a DuckDB SQL literal.
 */
function sqlEscape(v: string): string {
	return v.replace(/'/g, "''");
}

/**
 * Validate that a field name is safe for SQL (alphanumeric + underscores).
 */
function safeName(name: string): string {
	// Allow letters, digits, underscores, hyphens, spaces (quoted)
	if (!/^[\w\s-]+$/.test(name)) {
		throw new Error(`Invalid field name: ${name}`);
	}
	return `"${name.replace(/"/g, '""')}"`;
}

function buildRuleSQL(rule: FilterRule, fields: FieldMeta[]): string | null {
	const field = fields.find((f) => f.name === rule.field);
	if (!field) {return null;}

	const col = safeName(rule.field);
	const op = rule.operator;

	// Universal
	if (op === "is_empty") {return `(${col} IS NULL OR CAST(${col} AS VARCHAR) = '' OR CAST(${col} AS VARCHAR) = '[]')`;}
	if (op === "is_not_empty") {return `(${col} IS NOT NULL AND CAST(${col} AS VARCHAR) != '' AND CAST(${col} AS VARCHAR) != '[]')`;}

	// Boolean
	if (op === "is_true") {return `(LOWER(CAST(${col} AS VARCHAR)) IN ('true', '1', 'yes'))`;}
	if (op === "is_false") {return `(LOWER(CAST(${col} AS VARCHAR)) IN ('false', '0', 'no', ''))`;}

	// Text
	if (op === "contains") {return `(LOWER(CAST(${col} AS VARCHAR)) LIKE '%${sqlEscape(coerceString(rule.value).toLowerCase())}%')`;}
	if (op === "not_contains") {return `(LOWER(CAST(${col} AS VARCHAR)) NOT LIKE '%${sqlEscape(coerceString(rule.value).toLowerCase())}%')`;}
	if (op === "equals") {return `(LOWER(CAST(${col} AS VARCHAR)) = '${sqlEscape(coerceString(rule.value).toLowerCase())}')`;}
	if (op === "not_equals") {return `(LOWER(CAST(${col} AS VARCHAR)) != '${sqlEscape(coerceString(rule.value).toLowerCase())}')`;}
	if (op === "starts_with") {return `(LOWER(CAST(${col} AS VARCHAR)) LIKE '${sqlEscape(coerceString(rule.value).toLowerCase())}%')`;}
	if (op === "ends_with") {return `(LOWER(CAST(${col} AS VARCHAR)) LIKE '%${sqlEscape(coerceString(rule.value).toLowerCase())}')`;}

	// Number
	const numVal = coerceNumber(rule.value);
	if (op === "eq" && numVal != null) {return `(CAST(${col} AS DOUBLE) = ${numVal})`;}
	if (op === "neq" && numVal != null) {return `(CAST(${col} AS DOUBLE) != ${numVal})`;}
	if (op === "gt" && numVal != null) {return `(CAST(${col} AS DOUBLE) > ${numVal})`;}
	if (op === "gte" && numVal != null) {return `(CAST(${col} AS DOUBLE) >= ${numVal})`;}
	if (op === "lt" && numVal != null) {return `(CAST(${col} AS DOUBLE) < ${numVal})`;}
	if (op === "lte" && numVal != null) {return `(CAST(${col} AS DOUBLE) <= ${numVal})`;}
	if (op === "between") {
		const lo = coerceNumber(rule.value);
		const hi = coerceNumber(rule.valueTo);
		if (lo != null && hi != null) {return `(CAST(${col} AS DOUBLE) BETWEEN ${lo} AND ${hi})`;}
	}

	// Date
	if (op === "on") {
		const d = rule.value === "today" ? dateOnly(new Date()) : coerceString(rule.value);
		return `(CAST(${col} AS VARCHAR) LIKE '${sqlEscape(d)}%')`;
	}
	if (op === "before") {
		const d = rule.value === "today" ? dateOnly(new Date()) : coerceString(rule.value);
		return `(CAST(${col} AS DATE) < '${sqlEscape(d)}')`;
	}
	if (op === "after") {
		const d = rule.value === "today" ? dateOnly(new Date()) : coerceString(rule.value);
		return `(CAST(${col} AS DATE) > '${sqlEscape(d)}')`;
	}
	if (op === "date_between") {
		const from = coerceString(rule.value);
		const to = coerceString(rule.valueTo);
		return `(CAST(${col} AS DATE) BETWEEN '${sqlEscape(from)}' AND '${sqlEscape(to)}')`;
	}
	if (op === "relative_past") {
		const amount = rule.relativeAmount ?? 7;
		const unit = rule.relativeUnit ?? "days";
		const boundary = dateOnly(resolveRelativeDate(amount, unit, "past"));
		const today = dateOnly(new Date());
		return `(CAST(${col} AS DATE) BETWEEN '${sqlEscape(boundary)}' AND '${sqlEscape(today)}')`;
	}
	if (op === "relative_next") {
		const amount = rule.relativeAmount ?? 7;
		const unit = rule.relativeUnit ?? "days";
		const boundary = dateOnly(resolveRelativeDate(amount, unit, "next"));
		const today = dateOnly(new Date());
		return `(CAST(${col} AS DATE) BETWEEN '${sqlEscape(today)}' AND '${sqlEscape(boundary)}')`;
	}

	// Enum
	if (op === "is") {return `(CAST(${col} AS VARCHAR) = '${sqlEscape(coerceString(rule.value))}')`;}
	if (op === "is_not") {return `(CAST(${col} AS VARCHAR) != '${sqlEscape(coerceString(rule.value))}')`;}
	if (op === "is_any_of") {
		const vals = Array.isArray(rule.value) ? rule.value : [coerceString(rule.value)];
		const list = vals.map((v) => `'${sqlEscape(String(v))}'`).join(", ");
		return `(CAST(${col} AS VARCHAR) IN (${list}))`;
	}
	if (op === "is_none_of") {
		const vals = Array.isArray(rule.value) ? rule.value : [coerceString(rule.value)];
		const list = vals.map((v) => `'${sqlEscape(String(v))}'`).join(", ");
		return `(CAST(${col} AS VARCHAR) NOT IN (${list}))`;
	}

	// Relation / user — works on the raw text stored in the pivot view
	if (op === "has_any") {
		const vals = Array.isArray(rule.value) ? rule.value : [coerceString(rule.value)];
		const conditions = vals.map((v) => `CAST(${col} AS VARCHAR) LIKE '%${sqlEscape(String(v))}%'`);
		return `(${conditions.join(" OR ")})`;
	}
	if (op === "has_none") {
		const vals = Array.isArray(rule.value) ? rule.value : [coerceString(rule.value)];
		const conditions = vals.map((v) => `CAST(${col} AS VARCHAR) NOT LIKE '%${sqlEscape(String(v))}%'`);
		return `(${conditions.join(" AND ")})`;
	}
	if (op === "has_all") {
		const vals = Array.isArray(rule.value) ? rule.value : [coerceString(rule.value)];
		const conditions = vals.map((v) => `CAST(${col} AS VARCHAR) LIKE '%${sqlEscape(String(v))}%'`);
		return `(${conditions.join(" AND ")})`;
	}

	return null;
}

function buildGroupSQL(group: FilterGroup, fields: FieldMeta[]): string | null {
	const parts: string[] = [];
	for (const rule of group.rules) {
		const sql = isFilterGroup(rule)
			? buildGroupSQL(rule, fields)
			: buildRuleSQL(rule, fields);
		if (sql) {parts.push(sql);}
	}
	if (parts.length === 0) {return null;}
	const joiner = group.conjunction === "and" ? " AND " : " OR ";
	return `(${parts.join(joiner)})`;
}

/**
 * Build a SQL WHERE clause from a FilterGroup.
 * Returns the clause string (without the leading "WHERE"), or null if no filters.
 */
export function buildWhereClause(
	filters: FilterGroup | undefined,
	fields: FieldMeta[],
): string | null {
	if (!filters || filters.rules.length === 0) {return null;}
	return buildGroupSQL(filters, fields);
}

/**
 * Build a SQL ORDER BY clause from SortRule[].
 * Returns the clause string (without the leading "ORDER BY"), or null.
 */
export function buildOrderByClause(sort: SortRule[] | undefined): string | null {
	if (!sort || sort.length === 0) {return null;}
	return sort
		.map((s) => `${safeName(s.field)} ${s.direction === "desc" ? "DESC" : "ASC"}`)
		.join(", ");
}

// ---------------------------------------------------------------------------
// Serialization helpers
// ---------------------------------------------------------------------------

/** Encode a FilterGroup to a URL-safe base64 string. */
export function serializeFilters(filters: FilterGroup): string {
	return btoa(JSON.stringify(filters));
}

/** Decode a base64 filter string back to a FilterGroup. */
export function deserializeFilters(encoded: string): FilterGroup | null {
	try {
		return JSON.parse(atob(encoded)) as FilterGroup;
	} catch {
		return null;
	}
}

/** Create an empty filter group. */
export function emptyFilterGroup(): FilterGroup {
	return { id: "root", conjunction: "and", rules: [] };
}

/** Generate a short unique ID for filter rules/groups. */
export function filterId(): string {
	return Math.random().toString(36).slice(2, 9);
}

// ---------------------------------------------------------------------------
// Human-readable filter description
// ---------------------------------------------------------------------------

/** Return a short human-readable description of a filter rule. */
export function describeRule(rule: FilterRule): string {
	const field = rule.field;
	const op = rule.operator;
	const val = Array.isArray(rule.value)
		? rule.value.join(", ")
		: String(rule.value ?? "");

	if (op === "is_empty") {return `${field} is empty`;}
	if (op === "is_not_empty") {return `${field} is not empty`;}
	if (op === "is_true") {return `${field} is true`;}
	if (op === "is_false") {return `${field} is false`;}
	if (op === "between" || op === "date_between") {return `${field} between ${val} and ${rule.valueTo}`;}
	if (op === "relative_past") {return `${field} in the last ${rule.relativeAmount} ${rule.relativeUnit}`;}
	if (op === "relative_next") {return `${field} in the next ${rule.relativeAmount} ${rule.relativeUnit}`;}

	const opLabels: Record<string, string> = {
		contains: "contains",
		not_contains: "doesn't contain",
		equals: "=",
		not_equals: "≠",
		starts_with: "starts with",
		ends_with: "ends with",
		eq: "=",
		neq: "≠",
		gt: ">",
		gte: "≥",
		lt: "<",
		lte: "≤",
		before: "before",
		after: "after",
		on: "is",
		is: "is",
		is_not: "is not",
		is_any_of: "is any of",
		is_none_of: "is none of",
		has_any: "has any of",
		has_none: "has none of",
		has_all: "has all of",
	};

	return `${field} ${opLabels[op] ?? op} ${val}`;
}
