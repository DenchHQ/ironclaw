"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
	useReactTable,
	getCoreRowModel,
	getSortedRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	flexRender,
	type ColumnDef,
	type SortingState,
	type ColumnFiltersState,
	type VisibilityState,
	type Row,
	type OnChangeFn,
	type PaginationState,
} from "@tanstack/react-table";
import {
	DndContext,
	closestCenter,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	horizontalListSortingStrategy,
	useSortable,
	arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { rankItem } from "@tanstack/match-sorter-utils";

/* ─── Types ─── */

export type RowAction<TData> = {
	label: string;
	onClick?: (row: TData) => void;
	icon?: React.ReactNode;
	variant?: "default" | "destructive";
};

export type DataTableProps<TData, TValue> = {
	columns: ColumnDef<TData, TValue>[];
	data: TData[];
	loading?: boolean;
	// search
	searchPlaceholder?: string;
	enableGlobalFilter?: boolean;
	// sorting
	enableSorting?: boolean;
	// row selection
	enableRowSelection?: boolean;
	rowSelection?: Record<string, boolean>;
	onRowSelectionChange?: OnChangeFn<Record<string, boolean>>;
	bulkActions?: React.ReactNode;
	// column features
	enableColumnReordering?: boolean;
	onColumnReorder?: (newOrder: string[]) => void;
	initialColumnVisibility?: VisibilityState;
	// pagination
	pageSize?: number;
	// actions
	onRefresh?: () => void;
	onAdd?: () => void;
	addButtonLabel?: string;
	onRowClick?: (row: TData, index: number) => void;
	rowActions?: (row: TData) => RowAction<TData>[];
	// toolbar
	toolbarExtra?: React.ReactNode;
	title?: string;
	titleIcon?: React.ReactNode;
	// sticky
	stickyFirstColumn?: boolean;
	// server-side pagination
	serverPagination?: {
		totalCount: number;
		page: number;
		pageSize: number;
		onPageChange: (page: number) => void;
		onPageSizeChange: (size: number) => void;
	};
	// server-side search callback (replaces client-side fuzzy filter)
	onServerSearch?: (query: string) => void;
};

/* ─── Fuzzy filter ─── */

function fuzzyFilter(
	row: Row<unknown>,
	columnId: string,
	filterValue: string,
) {
	const result = rankItem(row.getValue(columnId), filterValue);
	return result.passed;
}

/* ─── Sortable header cell (DnD) ─── */

function SortableHeader({
	id,
	children,
	style,
	className,
}: {
	id: string;
	children: React.ReactNode;
	style?: React.CSSProperties;
	className?: string;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });

	const dragStyle: React.CSSProperties = {
		...style,
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
		cursor: "grab",
	};

	return (
		<th
			ref={setNodeRef}
			style={dragStyle}
			className={className}
			{...attributes}
			{...listeners}
		>
			{children}
		</th>
	);
}

/* ─── Sort icon ─── */

function SortIcon({ direction }: { direction: "asc" | "desc" | false }) {
	if (!direction) {
		return (
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }}>
				<path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" />
			</svg>
		);
	}
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			{direction === "asc" ? <path d="m5 12 7-7 7 7" /> : <path d="m19 12-7 7-7-7" />}
		</svg>
	);
}

/* ─── Main component ─── */

export function DataTable<TData, TValue>({
	columns,
	data,
	loading = false,
	searchPlaceholder = "Search...",
	enableGlobalFilter = true,
	enableSorting = true,
	enableRowSelection = false,
	rowSelection: externalRowSelection,
	onRowSelectionChange,
	bulkActions,
	enableColumnReordering = false,
	onColumnReorder,
	initialColumnVisibility,
	pageSize: defaultPageSize = 100,
	onRefresh,
	onAdd,
	addButtonLabel = "+ Add",
	onRowClick,
	rowActions,
	toolbarExtra,
	title,
	titleIcon,
	stickyFirstColumn: stickyFirstProp = true,
	serverPagination,
	onServerSearch,
}: DataTableProps<TData, TValue>) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialColumnVisibility ?? {});
	// Sync column visibility when the prop changes (e.g. loading a saved view)
	useEffect(() => {
		if (initialColumnVisibility) {
			setColumnVisibility(initialColumnVisibility);
		}
	}, [initialColumnVisibility]);
	const [internalRowSelection, setInternalRowSelection] = useState<Record<string, boolean>>({});
	const [showColumnsMenu, setShowColumnsMenu] = useState(false);
	const [stickyFirstColumn, setStickyFirstColumn] = useState(stickyFirstProp);
	const [isScrolled, setIsScrolled] = useState(false);
	const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: defaultPageSize });
	const columnsMenuRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const rowSelectionState = externalRowSelection !== undefined ? externalRowSelection : internalRowSelection;

	// Extract column ID from ColumnDef
	const getColumnId = useCallback((c: ColumnDef<TData, TValue>): string => {
		if ("id" in c && typeof c.id === "string") {return c.id;}
		if ("accessorKey" in c && typeof c.accessorKey === "string") {return c.accessorKey;}
		return "";
	}, []);

	// Column order for DnD — include "select" at start and "actions" at end
	// so TanStack doesn't push them to the end of the table
	const buildColumnOrder = useCallback(
		(dataCols: ColumnDef<TData, TValue>[]) => {
			const dataOrder = dataCols.map(getColumnId);
			const order: string[] = [];
			if (enableRowSelection) {order.push("select");}
			order.push(...dataOrder);
			if (rowActions) {order.push("actions");}
			return order;
		},
		[getColumnId, enableRowSelection, rowActions],
	);

	const [columnOrder, setColumnOrder] = useState<string[]>(() =>
		buildColumnOrder(columns),
	);

	// Update column order when columns change
	useEffect(() => {
		setColumnOrder(buildColumnOrder(columns));
	}, [columns, buildColumnOrder]);

	// DnD sensors
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (over && active.id !== over.id) {
				setColumnOrder((old) => {
					const oldIndex = old.indexOf(active.id as string);
					const newIndex = old.indexOf(over.id as string);
					const newOrder = arrayMove(old, oldIndex, newIndex);
					onColumnReorder?.(newOrder);
					return newOrder;
				});
			}
		},
		[onColumnReorder],
	);

	// Scroll tracking for sticky column shadow
	const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
		setIsScrolled(e.currentTarget.scrollLeft > 0);
	}, []);

	// Close columns menu on click outside
	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
				setShowColumnsMenu(false);
			}
		}
		if (showColumnsMenu) {
			document.addEventListener("mousedown", handleClick);
			return () => document.removeEventListener("mousedown", handleClick);
		}
	}, [showColumnsMenu]);

	// Build selection column
	const selectionColumn: ColumnDef<TData> | null = enableRowSelection
		? {
				id: "select",
				header: ({ table }) => (
					<input
						type="checkbox"
						checked={table.getIsAllPageRowsSelected()}
						onChange={table.getToggleAllPageRowsSelectedHandler()}
						className="w-3.5 h-3.5 rounded accent-[var(--color-accent)] cursor-pointer"
					/>
				),
				cell: ({ row }) => (
					<input
						type="checkbox"
						checked={row.getIsSelected()}
						onChange={row.getToggleSelectedHandler()}
						onClick={(e) => e.stopPropagation()}
						className="w-3.5 h-3.5 rounded accent-[var(--color-accent)] cursor-pointer"
					/>
				),
				size: 40,
				enableSorting: false,
				enableHiding: false,
			}
		: null;

	// Build actions column
	const actionsColumn: ColumnDef<TData> | null = rowActions
		? {
				id: "actions",
				header: () => null,
				cell: ({ row }) => (
					<RowActionsMenu
						row={row.original}
						actions={rowActions(row.original)}
					/>
				),
				size: 48,
				enableSorting: false,
				enableHiding: false,
			}
		: null;

	const allColumns = useMemo(() => {
		const cols: ColumnDef<TData, TValue>[] = [];
		if (selectionColumn) {cols.push(selectionColumn as ColumnDef<TData, TValue>);}
		cols.push(...columns);
		if (actionsColumn) {cols.push(actionsColumn as ColumnDef<TData, TValue>);}
		return cols;
	}, [columns, selectionColumn, actionsColumn]);

	// Server-side pagination state derived from props
	const serverPaginationState = serverPagination
		? { pageIndex: serverPagination.page - 1, pageSize: serverPagination.pageSize }
		: undefined;

	const table = useReactTable({
		data,
		columns: allColumns,
		state: {
			sorting,
			globalFilter,
			columnFilters,
			columnVisibility,
			rowSelection: rowSelectionState,
			columnOrder: enableColumnReordering ? columnOrder : undefined,
			pagination: serverPaginationState ?? pagination,
		},
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
		onRowSelectionChange: (updater) => {
			if (onRowSelectionChange) {
				onRowSelectionChange(updater);
			} else {
				setInternalRowSelection(updater);
			}
		},
		onPaginationChange: serverPagination
			? (updater) => {
				const newVal = typeof updater === "function"
					? updater(serverPaginationState!)
					: updater;
				if (newVal.pageSize !== serverPagination.pageSize) {
					serverPagination.onPageSizeChange(newVal.pageSize);
				} else if (newVal.pageIndex !== serverPagination.page - 1) {
					serverPagination.onPageChange(newVal.pageIndex + 1);
				}
			}
			: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
		getFilteredRowModel: serverPagination ? undefined : getFilteredRowModel(),
		getPaginationRowModel: serverPagination ? undefined : getPaginationRowModel(),
		...(serverPagination ? {
			manualPagination: true,
			pageCount: Math.ceil(serverPagination.totalCount / serverPagination.pageSize),
		} : {}),
		enableRowSelection,
		enableSorting,
		globalFilterFn: fuzzyFilter,
		columnResizeMode: "onChange",
	});

	const selectedCount = Object.keys(rowSelectionState).filter((k) => rowSelectionState[k]).length;
	const visibleColumns = table.getVisibleFlatColumns().filter((c) => c.id !== "select" && c.id !== "actions");

	// ─── Render ───

	return (
		<div className="flex flex-col h-full">
			{/* Toolbar */}
			<div
				className="flex items-center gap-2 px-4 py-2.5 flex-shrink-0 flex-wrap"
				style={{ borderBottom: "1px solid var(--color-border)" }}
			>
				{title && (
					<div className="flex items-center gap-2 mr-2">
						{titleIcon}
						<span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
							{title}
						</span>
					</div>
				)}

				{/* Search */}
				{enableGlobalFilter && (
					<div className="relative flex-1 min-w-[180px] max-w-[320px]">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-muted)" }}>
							<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
						</svg>
						<input
							type="text"
							value={globalFilter}
							onChange={(e) => {
								setGlobalFilter(e.target.value);
								onServerSearch?.(e.target.value);
							}}
							placeholder={searchPlaceholder}
							className="w-full pl-9 pr-3 py-1.5 text-xs rounded-full outline-none"
							style={{
								background: "var(--color-surface-hover)",
								color: "var(--color-text)",
								border: "1px solid var(--color-border)",
							}}
						/>
						{globalFilter && (
							<button
								type="button"
								onClick={() => { setGlobalFilter(""); onServerSearch?.(""); }}
								className="absolute right-2.5 top-1/2 -translate-y-1/2"
								style={{ color: "var(--color-text-muted)" }}
							>
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
							</button>
						)}
					</div>
				)}

				{/* Bulk actions */}
				{selectedCount > 0 && bulkActions && (
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
							{selectedCount} selected
						</span>
						{bulkActions}
					</div>
				)}

				<div className="flex-1" />

				{toolbarExtra}

				{/* Refresh */}
				{onRefresh && (
					<button
						type="button"
						onClick={onRefresh}
						className="p-1.5 rounded-lg"
						style={{ color: "var(--color-text-muted)" }}
						title="Refresh"
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" />
						</svg>
					</button>
				)}

				{/* Columns menu */}
				<div className="relative" ref={columnsMenuRef}>
					<button
						type="button"
						onClick={() => setShowColumnsMenu((v) => !v)}
						className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium"
						style={{
							color: "var(--color-text-muted)",
							border: "1px solid var(--color-border)",
							background: showColumnsMenu ? "var(--color-surface-hover)" : "transparent",
						}}
					>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="M15 3v18" />
						</svg>
						Columns
					</button>
					{showColumnsMenu && (
						<div
							className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-xl overflow-hidden py-1"
							style={{
								background: "var(--color-surface)",
								border: "1px solid var(--color-border)",
								boxShadow: "var(--shadow-lg)",
							}}
						>
							{/* Sticky first col toggle */}
							<label
								className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer"
								style={{ color: "var(--color-text-muted)", borderBottom: "1px solid var(--color-border)" }}
							>
								<input
									type="checkbox"
									checked={stickyFirstColumn}
									onChange={() => setStickyFirstColumn((v) => !v)}
									className="w-3.5 h-3.5 rounded accent-[var(--color-accent)]"
								/>
								Freeze first column
							</label>
							{visibleColumns.length === 0 ? (
								<div className="px-3 py-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
									No toggleable columns
								</div>
							) : (
								table.getAllLeafColumns()
									.filter((c) => c.id !== "select" && c.id !== "actions" && c.getCanHide())
									.map((column) => (
										<label
											key={column.id}
											className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer"
											style={{ color: "var(--color-text)" }}
										>
											<input
												type="checkbox"
												checked={column.getIsVisible()}
												onChange={column.getToggleVisibilityHandler()}
												className="w-3.5 h-3.5 rounded accent-[var(--color-accent)]"
											/>
											{typeof column.columnDef.header === "string"
												? column.columnDef.header
												: String((column.columnDef.meta as Record<string, string> | undefined)?.label ?? column.id)}
										</label>
									))
							)}
						</div>
					)}
				</div>

				{/* Add button */}
				{onAdd && (
					<button
						type="button"
						onClick={onAdd}
						className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
						style={{
							background: "var(--color-accent)",
							color: "white",
						}}
					>
						{addButtonLabel}
					</button>
				)}
			</div>

			{/* Table */}
			<div
				ref={scrollContainerRef}
				className="flex-1 overflow-auto min-w-0"
				onScroll={handleScroll}
			>
				{loading ? (
					<LoadingSkeleton columnCount={allColumns.length} />
				) : data.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-20 gap-3">
						<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
							<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" />
						</svg>
						<p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No data</p>
					</div>
				) : (
					<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
						<table className="w-full text-sm" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
							<thead>
								{table.getHeaderGroups().map((headerGroup) => (
									<tr key={headerGroup.id}>
										<SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
											{headerGroup.headers.map((header, colIdx) => {
												const isFirstData = colIdx === (enableRowSelection ? 1 : 0);
												const isSticky = stickyFirstColumn && isFirstData;
												const isSelectCol = header.id === "select";
												const isActionsCol = header.id === "actions";
												const canSort = header.column.getCanSort();

												const headerStyle: React.CSSProperties = {
													borderColor: "var(--color-border)",
													background: "var(--color-surface)",
													position: "sticky",
													top: 0,
													zIndex: isSticky || isSelectCol ? 31 : 30,
													...(isSticky ? { left: enableRowSelection ? 40 : 0, boxShadow: isScrolled ? "4px 0 8px -2px rgba(0,0,0,0.08)" : "none" } : {}),
													...(isSelectCol ? { left: 0, position: "sticky", zIndex: 31, width: 40 } : {}),
													width: header.getSize(),
												};

												const content = header.isPlaceholder
													? null
													: flexRender(header.column.columnDef.header, header.getContext());

												if (enableColumnReordering && !isSelectCol && !isActionsCol) {
													return (
														<SortableHeader
															key={header.id}
															id={header.id}
															style={headerStyle}
															className="text-left px-3 py-2.5 font-medium text-xs uppercase tracking-wider whitespace-nowrap border-b select-none"
														>
															<span
																className={`flex items-center gap-1 ${canSort ? "cursor-pointer" : ""}`}
																onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
															>
																{content}
																{canSort && <SortIcon direction={header.column.getIsSorted()} />}
															</span>
														</SortableHeader>
													);
												}

												return (
													<th
														key={header.id}
														style={headerStyle}
														className="text-left px-3 py-2.5 font-medium text-xs uppercase tracking-wider whitespace-nowrap border-b select-none"
													>
														<span
															className={`flex items-center gap-1 ${canSort ? "cursor-pointer" : ""}`}
															onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
															style={{ color: "var(--color-text-muted)" }}
														>
															{content}
															{canSort && <SortIcon direction={header.column.getIsSorted()} />}
														</span>
													</th>
												);
											})}
										</SortableContext>
									</tr>
								))}
							</thead>
							<tbody>
								{table.getRowModel().rows.map((row, rowIdx) => {
									const isSelected = row.getIsSelected();
									return (
										<tr
											key={row.id}
											className={`transition-colors duration-75 ${onRowClick ? "cursor-pointer" : ""}`}
											style={{
												background: isSelected
													? "var(--color-accent-light)"
													: rowIdx % 2 === 0
														? "transparent"
														: "var(--color-surface)",
											}}
											onClick={() => onRowClick?.(row.original, rowIdx)}
											onMouseEnter={(e) => {
												if (!isSelected)
													{(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";}
											}}
											onMouseLeave={(e) => {
												if (!isSelected)
													{(e.currentTarget as HTMLElement).style.background =
														rowIdx % 2 === 0 ? "transparent" : "var(--color-surface)";}
											}}
										>
											{row.getVisibleCells().map((cell, colIdx) => {
												const isFirstData = colIdx === (enableRowSelection ? 1 : 0);
												const isSticky = stickyFirstColumn && isFirstData;
												const isSelectCol = cell.column.id === "select";

												const cellStyle: React.CSSProperties = {
													borderColor: "var(--color-border)",
													...(isSticky
														? {
																position: "sticky" as const,
																left: enableRowSelection ? 40 : 0,
																zIndex: 20,
																background: isSelected
																	? "var(--color-accent-light)"
																	: "var(--color-bg)",
																boxShadow: isScrolled ? "4px 0 8px -2px rgba(0,0,0,0.08)" : "none",
															}
														: {}),
													...(isSelectCol
														? {
																position: "sticky" as const,
																left: 0,
																zIndex: 20,
																background: isSelected
																	? "var(--color-accent-light)"
																	: "var(--color-bg)",
																width: 40,
															}
														: {}),
												};

												return (
													<td
														key={cell.id}
														className="px-3 py-2 border-b whitespace-nowrap"
														style={cellStyle}
													>
														{flexRender(cell.column.columnDef.cell, cell.getContext())}
													</td>
												);
											})}
										</tr>
									);
								})}
							</tbody>
						</table>
					</DndContext>
				)}
			</div>

			{/* Pagination footer */}
			{!loading && data.length > 0 && (
				<div
					className="flex items-center justify-between px-4 py-2 text-xs flex-shrink-0"
					style={{
						borderTop: "1px solid var(--color-border)",
						color: "var(--color-text-muted)",
					}}
				>
					<span>
						{serverPagination
							? `Showing ${(serverPagination.page - 1) * serverPagination.pageSize + 1}–${Math.min(serverPagination.page * serverPagination.pageSize, serverPagination.totalCount)} of ${serverPagination.totalCount} results`
							: `Showing ${table.getRowModel().rows.length} of ${data.length} results`}
						{selectedCount > 0 && ` (${selectedCount} selected)`}
					</span>
					<div className="flex items-center gap-2">
						<span>Rows per page</span>
						<select
							value={serverPagination ? serverPagination.pageSize : pagination.pageSize}
							onChange={(e) => {
								const newSize = Number(e.target.value);
								if (serverPagination) {
									serverPagination.onPageSizeChange(newSize);
								} else {
									setPagination((p) => ({ ...p, pageSize: newSize, pageIndex: 0 }));
								}
							}}
							className="px-1.5 py-0.5 rounded-md text-xs outline-none"
							style={{
								background: "var(--color-surface-hover)",
								color: "var(--color-text)",
								border: "1px solid var(--color-border)",
							}}
						>
							{[20, 50, 100, 250, 500].map((size) => (
								<option key={size} value={size}>{size}</option>
							))}
						</select>
						<span>
							Page {serverPagination ? serverPagination.page : pagination.pageIndex + 1} of {table.getPageCount()}
						</span>
						<div className="flex gap-0.5">
							{serverPagination ? (
								<>
									<PaginationButton onClick={() => serverPagination.onPageChange(1)} disabled={serverPagination.page <= 1} label="&laquo;" />
									<PaginationButton onClick={() => serverPagination.onPageChange(serverPagination.page - 1)} disabled={serverPagination.page <= 1} label="&lsaquo;" />
									<PaginationButton onClick={() => serverPagination.onPageChange(serverPagination.page + 1)} disabled={serverPagination.page >= Math.ceil(serverPagination.totalCount / serverPagination.pageSize)} label="&rsaquo;" />
									<PaginationButton onClick={() => serverPagination.onPageChange(Math.ceil(serverPagination.totalCount / serverPagination.pageSize))} disabled={serverPagination.page >= Math.ceil(serverPagination.totalCount / serverPagination.pageSize)} label="&raquo;" />
								</>
							) : (
								<>
									<PaginationButton onClick={() => setPagination((p) => ({ ...p, pageIndex: 0 }))} disabled={!table.getCanPreviousPage()} label="&laquo;" />
									<PaginationButton onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} label="&lsaquo;" />
									<PaginationButton onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} label="&rsaquo;" />
									<PaginationButton onClick={() => setPagination((p) => ({ ...p, pageIndex: table.getPageCount() - 1 }))} disabled={!table.getCanNextPage()} label="&raquo;" />
								</>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/* ─── Sub-components ─── */

function PaginationButton({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="w-6 h-6 rounded flex items-center justify-center text-xs disabled:opacity-30"
			style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)" }}
			// biome-ignore lint: using html entity label
			dangerouslySetInnerHTML={{ __html: label }}
		/>
	);
}

function RowActionsMenu<TData>({ row, actions }: { row: TData; actions: RowAction<TData>[] }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (ref.current && !ref.current.contains(e.target as Node)) {
				setOpen(false);
			}
		}
		if (open) {
			document.addEventListener("mousedown", handleClick);
			return () => document.removeEventListener("mousedown", handleClick);
		}
	}, [open]);

	return (
		<div className="relative" ref={ref}>
			<button
				type="button"
				onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
				className="p-1 rounded-md"
				style={{ color: "var(--color-text-muted)" }}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
			</button>
			{open && (
				<div
					className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-xl overflow-hidden py-1"
					style={{
						background: "var(--color-surface)",
						border: "1px solid var(--color-border)",
						boxShadow: "var(--shadow-lg)",
					}}
				>
					{actions.map((action, i) => (
						<button
							key={i}
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								action.onClick?.(row);
								setOpen(false);
							}}
							className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left"
							style={{
								color: action.variant === "destructive" ? "var(--color-error)" : "var(--color-text)",
							}}
						>
							{action.icon}
							{action.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function LoadingSkeleton({ columnCount }: { columnCount: number }) {
	return (
		<div className="p-4 space-y-2">
			{Array.from({ length: 12 }).map((_, i) => (
				<div key={i} className="flex gap-3">
					{Array.from({ length: Math.min(columnCount, 6) }).map((_col, j) => (
						<div
							key={j}
							className="h-8 rounded-lg animate-pulse flex-1"
							style={{ background: "var(--color-surface-hover)", animationDelay: `${j * 50}ms` }}
						/>
					))}
				</div>
			))}
		</div>
	);
}
