"use client";

import { useState, useEffect } from "react";

/**
 * Returns true when the viewport is narrower than `breakpoint` (default 768px).
 * Uses `matchMedia` for efficiency; falls back to `false` during SSR.
 */
export function useIsMobile(breakpoint = 768): boolean {
	const [isMobile, setIsMobile] = useState(false);

	useEffect(() => {
		const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
		const update = () => setIsMobile(mql.matches);
		update();
		mql.addEventListener("change", update);
		return () => mql.removeEventListener("change", update);
	}, [breakpoint]);

	return isMobile;
}
