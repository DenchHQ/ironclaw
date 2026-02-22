import { describe, it, expect } from "vitest";
import {
	normalizeFilterRule,
	normalizeFilterGroup,
	matchesFilter,
	buildWhereClause,
	type FilterRule,
	type FilterGroup,
	type FieldMeta,
} from "./object-filters";

// ─── normalizeFilterRule ───

describe("normalizeFilterRule", () => {
	it("splits array value into value/valueTo for date_between", () => {
		const rule: FilterRule = {
			id: "r1",
			field: "Due Date",
			operator: "date_between",
			value: ["2026-03-01", "2026-03-31"],
		};
		const result = normalizeFilterRule(rule);
		expect(result.value).toBe("2026-03-01");
		expect(result.valueTo).toBe("2026-03-31");
	});

	it("splits array value into value/valueTo for numeric between", () => {
		const rule: FilterRule = {
			id: "r2",
			field: "Score",
			operator: "between",
			value: ["10", "50"] as unknown as string[],
		};
		const result = normalizeFilterRule(rule);
		expect(result.value).toBe("10");
		expect(result.valueTo).toBe("50");
	});

	it("does not touch date_between when valueTo already set", () => {
		const rule: FilterRule = {
			id: "r3",
			field: "Due Date",
			operator: "date_between",
			value: "2026-03-01",
			valueTo: "2026-03-31",
		};
		const result = normalizeFilterRule(rule);
		expect(result.value).toBe("2026-03-01");
		expect(result.valueTo).toBe("2026-03-31");
	});

	it("does not touch non-range operators", () => {
		const rule: FilterRule = {
			id: "r4",
			field: "Status",
			operator: "is_any_of",
			value: ["In Progress", "Done"],
		};
		const result = normalizeFilterRule(rule);
		expect(result.value).toEqual(["In Progress", "Done"]);
		expect(result.valueTo).toBeUndefined();
	});
});

// ─── normalizeFilterGroup ───

describe("normalizeFilterGroup", () => {
	it("recursively normalizes nested groups", () => {
		const group: FilterGroup = {
			id: "root",
			conjunction: "and",
			rules: [
				{
					id: "f1",
					field: "Due Date",
					operator: "date_between",
					value: ["2026-03-01", "2026-03-31"],
				} as FilterRule,
				{
					id: "nested",
					conjunction: "or",
					rules: [
						{
							id: "f2",
							field: "Score",
							operator: "between",
							value: ["1", "100"] as unknown as string[],
						} as FilterRule,
					],
				},
			],
		};
		const result = normalizeFilterGroup(group);

		const r1 = result.rules[0] as FilterRule;
		expect(r1.value).toBe("2026-03-01");
		expect(r1.valueTo).toBe("2026-03-31");

		const nested = result.rules[1] as FilterGroup;
		const r2 = nested.rules[0] as FilterRule;
		expect(r2.value).toBe("1");
		expect(r2.valueTo).toBe("100");
	});
});

// ─── matchesFilter with array-style date_between ───

describe("matchesFilter with array-style date_between", () => {
	const entries = [
		{ "Due Date": "2026-03-10" },
		{ "Due Date": "2026-02-28" },
		{ "Due Date": "2026-04-01" },
		{ "Due Date": "2026-03-01" },
		{ "Due Date": "2026-03-31" },
	];

	it("correctly filters with normalized value/valueTo", () => {
		const filters: FilterGroup = {
			id: "root",
			conjunction: "and",
			rules: [
				{
					id: "f1",
					field: "Due Date",
					operator: "date_between",
					value: "2026-03-01",
					valueTo: "2026-03-31",
				},
			],
		};
		const result = matchesFilter(entries, filters);
		expect(result).toEqual([
			{ "Due Date": "2026-03-10" },
			{ "Due Date": "2026-03-01" },
			{ "Due Date": "2026-03-31" },
		]);
	});

	it("correctly filters with array-style value (defensive fallback)", () => {
		const filters: FilterGroup = {
			id: "root",
			conjunction: "and",
			rules: [
				{
					id: "f1",
					field: "Due Date",
					operator: "date_between",
					value: ["2026-03-01", "2026-03-31"],
				} as FilterRule,
			],
		};
		const result = matchesFilter(entries, filters);
		expect(result).toEqual([
			{ "Due Date": "2026-03-10" },
			{ "Due Date": "2026-03-01" },
			{ "Due Date": "2026-03-31" },
		]);
	});
});

// ─── buildWhereClause with array-style date_between ───

describe("buildWhereClause with array-style date_between", () => {
	const fields: FieldMeta[] = [{ name: "Due Date", type: "date" }];

	it("builds correct SQL with value/valueTo", () => {
		const filters: FilterGroup = {
			id: "root",
			conjunction: "and",
			rules: [
				{
					id: "f1",
					field: "Due Date",
					operator: "date_between",
					value: "2026-03-01",
					valueTo: "2026-03-31",
				},
			],
		};
		const sql = buildWhereClause(filters, fields);
		expect(sql).toBe(
			`((CAST("Due Date" AS DATE) BETWEEN '2026-03-01' AND '2026-03-31'))`,
		);
	});

	it("builds correct SQL with array-style value (defensive fallback)", () => {
		const filters: FilterGroup = {
			id: "root",
			conjunction: "and",
			rules: [
				{
					id: "f1",
					field: "Due Date",
					operator: "date_between",
					value: ["2026-03-01", "2026-03-31"],
				} as FilterRule,
			],
		};
		const sql = buildWhereClause(filters, fields);
		expect(sql).toBe(
			`((CAST("Due Date" AS DATE) BETWEEN '2026-03-01' AND '2026-03-31'))`,
		);
	});
});

// ─── buildWhereClause with array-style numeric between ───

describe("buildWhereClause with array-style numeric between", () => {
	const fields: FieldMeta[] = [{ name: "Score", type: "number" }];

	it("builds correct SQL with array-style value", () => {
		const filters: FilterGroup = {
			id: "root",
			conjunction: "and",
			rules: [
				{
					id: "f1",
					field: "Score",
					operator: "between",
					value: ["10", "50"] as unknown as string[],
				} as FilterRule,
			],
		};
		const sql = buildWhereClause(filters, fields);
		expect(sql).toBe(`((CAST("Score" AS DOUBLE) BETWEEN 10 AND 50))`);
	});
});
