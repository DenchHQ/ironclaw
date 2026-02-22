"use client";

import { useState, useEffect } from "react";
import spinners from "unicode-animations";

type SpinnerName = keyof typeof spinners;

export function UnicodeSpinner({
	name = "braille",
	children,
	className,
	style,
}: {
	name?: SpinnerName;
	children?: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
}) {
	const [frame, setFrame] = useState(0);
	const s = spinners[name];

	useEffect(() => {
		const timer = setInterval(
			() => setFrame((f) => (f + 1) % s.frames.length),
			s.interval,
		);
		return () => clearInterval(timer);
	}, [name, s.frames.length, s.interval]);

	return (
		<span className={className} style={{ fontFamily: "monospace", ...style }}>
			{s.frames[frame]}
			{children != null && <> {children}</>}
		</span>
	);
}
