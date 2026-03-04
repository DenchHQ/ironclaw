"use client";

import { formatWorkspaceFieldValue } from "@/lib/workspace-cell-format";

type FormattedFieldValueProps = {
	value: unknown;
	fieldType?: string;
	mode?: "table" | "detail";
	className?: string;
};

function EmptyValue() {
	return <span style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>--</span>;
}

function FileEmbed({
	mediaType,
	url,
	label,
}: {
	mediaType: "image" | "video" | "audio" | "pdf";
	url: string;
	label: string;
}) {
	if (mediaType === "image") {
		return (
			<div className="mt-2 rounded-lg overflow-hidden border" style={{ borderColor: "var(--color-border)" }}>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img src={url} alt={label} className="max-h-64 w-auto" />
			</div>
		);
	}
	if (mediaType === "video") {
		return (
			<video
				src={url}
				controls
				className="mt-2 w-full max-h-72 rounded-lg border"
				style={{ borderColor: "var(--color-border)", background: "#000" }}
			/>
		);
	}
	if (mediaType === "audio") {
		return <audio src={url} controls className="mt-2 w-full" />;
	}
	return (
		<iframe
			src={`${url}#toolbar=0&navpanes=0&scrollbar=1`}
			title={label}
			className="mt-2 w-full h-72 rounded-lg border"
			style={{ borderColor: "var(--color-border)", background: "white" }}
		/>
	);
}

export function FormattedFieldValue({
	value,
	fieldType,
	mode = "table",
	className,
}: FormattedFieldValueProps) {
	const formatted = formatWorkspaceFieldValue(value, fieldType);
	const isTableMode = mode === "table";
	const textClassName = className ?? (isTableMode ? "truncate block max-w-[300px]" : "break-words");

	if (formatted.kind === "empty") {
		return <EmptyValue />;
	}

	if (formatted.kind === "link" && formatted.href) {
		const openInNewTab = formatted.linkType === "url" || formatted.linkType === "file";
		const canEmbedInModal = !isTableMode && !!formatted.embedUrl && !!formatted.mediaType;
		return (
			<div className={isTableMode ? "truncate block max-w-[300px]" : "w-full"}>
				<a
					href={formatted.href}
					{...(openInNewTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
					className={`underline underline-offset-2 ${isTableMode ? "truncate block" : ""}`}
					style={{ color: "var(--color-accent)" }}
					onClick={(e) => e.stopPropagation()}
				>
					{formatted.text}
				</a>
				{canEmbedInModal && (
					<FileEmbed
						mediaType={formatted.mediaType!}
						url={formatted.embedUrl!}
						label={formatted.text}
					/>
				)}
			</div>
		);
	}

	if (formatted.kind === "number" || formatted.kind === "currency") {
		return <span className={`tabular-nums ${textClassName}`}>{formatted.text}</span>;
	}

	return <span className={textClassName}>{formatted.text}</span>;
}
