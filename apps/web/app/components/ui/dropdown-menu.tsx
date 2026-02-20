"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronRightIcon, CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function DropdownMenu({
	...props
}: React.ComponentProps<typeof MenuPrimitive.Root>) {
	return (
		<MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
	);
}

function DropdownMenuPortal({
	...props
}: React.ComponentProps<typeof MenuPrimitive.Portal>) {
	return (
		<MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
	);
}

function DropdownMenuTrigger({
	...props
}: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
	return (
		<MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
	);
}

function DropdownMenuContent({
	align = "start",
	alignOffset = 0,
	side = "bottom",
	sideOffset = 4,
	className,
	...props
}: React.ComponentProps<typeof MenuPrimitive.Popup> &
	Pick<
		React.ComponentProps<typeof MenuPrimitive.Positioner>,
		"align" | "alignOffset" | "side" | "sideOffset"
	>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				className="isolate z-[100] outline-none"
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
			>
				<MenuPrimitive.Popup
					data-slot="dropdown-menu-content"
					className={cn(
						"min-w-32 rounded-lg p-1 shadow-md duration-100 overflow-x-hidden overflow-y-auto outline-none",
						"bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)]",
						"data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
						className,
					)}
					{...props}
				/>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

function DropdownMenuGroup({
	...props
}: React.ComponentProps<typeof MenuPrimitive.Group>) {
	return (
		<MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
	);
}

function DropdownMenuLabel({
	className,
	inset,
	...props
}: React.ComponentProps<typeof MenuPrimitive.GroupLabel> & {
	inset?: boolean;
}) {
	return (
		<MenuPrimitive.GroupLabel
			data-slot="dropdown-menu-label"
			data-inset={inset}
			className={cn(
				"px-1.5 py-1 text-xs font-medium text-[var(--color-text-muted)]",
				inset && "pl-7",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuItem({
	className,
	inset,
	variant = "default",
	onSelect,
	onClick,
	...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
	inset?: boolean;
	variant?: "default" | "destructive";
	onSelect?: () => void;
}) {
	const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
		onClick?.(e);
		onSelect?.();
	};
	return (
		<MenuPrimitive.Item
			data-slot="dropdown-menu-item"
			data-inset={inset}
			data-variant={variant}
			className={cn(
				"gap-1.5 rounded-md px-1.5 py-1 text-sm relative flex cursor-default items-center outline-none select-none",
				"focus:bg-[var(--color-surface-hover)] focus:text-[var(--color-text)]",
				"data-[variant=destructive]:text-[var(--color-error)] data-[variant=destructive]:focus:bg-[var(--color-error)]/10 data-[variant=destructive]:focus:text-[var(--color-error)]",
				inset && "pl-7",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				className,
			)}
			onClick={handleClick}
			{...props}
		/>
	);
}

function DropdownMenuSub({
	...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuRoot>) {
	return (
		<MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
	);
}

function DropdownMenuSubTrigger({
	className,
	inset,
	children,
	...props
}: React.ComponentProps<typeof MenuPrimitive.SubmenuTrigger> & {
	inset?: boolean;
}) {
	return (
		<MenuPrimitive.SubmenuTrigger
			data-slot="dropdown-menu-sub-trigger"
			data-inset={inset}
			className={cn(
				"focus:bg-[var(--color-surface-hover)] focus:text-[var(--color-text)] data-open:bg-[var(--color-surface-hover)] data-open:text-[var(--color-text)]",
				"gap-1.5 rounded-md px-1.5 py-1 text-sm flex cursor-default items-center outline-none select-none",
				inset && "pl-7",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			{...props}
		>
			{children}
			<ChevronRightIcon className="ml-auto size-4" />
		</MenuPrimitive.SubmenuTrigger>
	);
}

function DropdownMenuSubContent({
	align = "start",
	alignOffset = -3,
	side = "right",
	sideOffset = 0,
	className,
	...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
	return (
		<DropdownMenuContent
			data-slot="dropdown-menu-sub-content"
			className={cn("min-w-[96px]", className)}
			align={align}
			alignOffset={alignOffset}
			side={side}
			sideOffset={sideOffset}
			{...props}
		/>
	);
}

function DropdownMenuCheckboxItem({
	className,
	children,
	checked,
	inset,
	...props
}: React.ComponentProps<typeof MenuPrimitive.CheckboxItem> & {
	inset?: boolean;
}) {
	return (
		<MenuPrimitive.CheckboxItem
			data-slot="dropdown-menu-checkbox-item"
			data-inset={inset}
			className={cn(
				"focus:bg-[var(--color-surface-hover)] focus:text-[var(--color-text)]",
				"gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm relative flex cursor-default items-center outline-none select-none",
				inset && "pl-7",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				className,
			)}
			checked={checked}
			{...props}
		>
			<span
				className="absolute right-2 flex items-center justify-center pointer-events-none"
				data-slot="dropdown-menu-checkbox-item-indicator"
			>
				<MenuPrimitive.CheckboxItemIndicator>
					<CheckIcon className="size-4" />
				</MenuPrimitive.CheckboxItemIndicator>
			</span>
			{children}
		</MenuPrimitive.CheckboxItem>
	);
}

function DropdownMenuRadioGroup({
	...props
}: React.ComponentProps<typeof MenuPrimitive.RadioGroup>) {
	return (
		<MenuPrimitive.RadioGroup
			data-slot="dropdown-menu-radio-group"
			{...props}
		/>
	);
}

function DropdownMenuRadioItem({
	className,
	children,
	inset,
	...props
}: React.ComponentProps<typeof MenuPrimitive.RadioItem> & {
	inset?: boolean;
}) {
	return (
		<MenuPrimitive.RadioItem
			data-slot="dropdown-menu-radio-item"
			data-inset={inset}
			className={cn(
				"focus:bg-[var(--color-surface-hover)] focus:text-[var(--color-text)]",
				"gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm relative flex cursor-default items-center outline-none select-none",
				inset && "pl-7",
				"[&_svg]:pointer-events-none [&_svg]:shrink-0",
				"data-disabled:pointer-events-none data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<span
				className="absolute right-2 flex items-center justify-center pointer-events-none"
				data-slot="dropdown-menu-radio-item-indicator"
			>
				<MenuPrimitive.RadioItemIndicator>
					<CheckIcon className="size-4" />
				</MenuPrimitive.RadioItemIndicator>
			</span>
			{children}
		</MenuPrimitive.RadioItem>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: React.ComponentProps<typeof MenuPrimitive.Separator>) {
	return (
		<MenuPrimitive.Separator
			data-slot="dropdown-menu-separator"
			className={cn(
				"bg-[var(--color-border)] -mx-1 my-1 h-px",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuShortcut({
	className,
	...props
}: React.ComponentProps<"span">) {
	return (
		<span
			data-slot="dropdown-menu-shortcut"
			className={cn(
				"text-[var(--color-text-muted)] ml-auto text-xs tracking-widest",
				className,
			)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuPortal,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuItem,
	DropdownMenuCheckboxItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubTrigger,
	DropdownMenuSubContent,
};
