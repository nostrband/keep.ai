import * as React from "react";
import type { Virtualizer } from "@tanstack/virtual-core";

type Options = {
  bottomThresholdPx?: number;
};

export function useVirtualPinnedToBottom(
  virtualizer: Virtualizer<any, any>,
  opts: Options = {}
) {
  const bottomThresholdPx = opts.bottomThresholdPx ?? 8;
  const pinnedRef = React.useRef(true);

  const getScrollEl = () => virtualizer.scrollElement;

  const isAtBottom = React.useCallback(() => {
    const el = getScrollEl();
    if (!el) return true;
    const maxOffset = Math.max(0, virtualizer.getTotalSize() - el.clientHeight);
    return el.scrollTop >= maxOffset - bottomThresholdPx;
  }, [virtualizer, bottomThresholdPx]);

  // Track pin/unpin by user scrolling
  React.useEffect(() => {
    const el = getScrollEl();
    if (!el) return;

    const onScroll = () => {
      pinnedRef.current = isAtBottom();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    pinnedRef.current = isAtBottom();

    return () => el.removeEventListener("scroll", onScroll);
  }, [isAtBottom]);

  // When virtual total size changes (due to remeasure), re-anchor if pinned
  const totalSize = virtualizer.getTotalSize();
  React.useLayoutEffect(() => {
    const el = getScrollEl();
    if (!el) return;

    if (pinnedRef.current) {
      const bottomOffset = Math.max(0, virtualizer.getTotalSize() - el.clientHeight);
      // Use the virtualizer API (better than setting scrollTop directly)
      virtualizer.scrollToOffset(bottomOffset, { align: "start" });
    }
  }, [totalSize, virtualizer]);

  // Helper you can call when you *know* you want to pin (e.g., on reload)
  const scrollToBottom = React.useCallback(() => {
    const el = getScrollEl();
    if (!el) return;
    pinnedRef.current = true;
    const bottomOffset = Math.max(0, virtualizer.getTotalSize() - el.clientHeight);
    virtualizer.scrollToOffset(bottomOffset, { align: "start" });
  }, [virtualizer]);

  return { pinnedRef, scrollToBottom, isAtBottom };
}
