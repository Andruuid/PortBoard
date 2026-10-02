"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface PointerPosition {
  clientX: number;
  clientY: number;
}

interface ShowPosition extends PointerPosition {
  /** The hovered element; the tooltip closes once the pointer leaves it. */
  currentTarget: Element;
}

interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
  anchor: Element;
}

interface TooltipApi {
  show: (position: ShowPosition, content: ReactNode) => void;
  move: (position: PointerPosition) => void;
  hide: () => void;
}

const POINTER_GAP = 14;
const VIEWPORT_MARGIN = 8;

const ChartTooltipContext = createContext<TooltipApi | null>(null);

function TooltipBubble({ state }: { state: TooltipState | null }) {
  const bubbleRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    if (!bubble || !state) {
      return;
    }

    const { width, height } = bubble.getBoundingClientRect();
    let left = state.x + POINTER_GAP;
    let top = state.y + POINTER_GAP;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = state.x - width - POINTER_GAP;
    }
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = state.y - height - POINTER_GAP;
    }
    bubble.style.transform = `translate(${Math.max(VIEWPORT_MARGIN, left)}px, ${Math.max(VIEWPORT_MARGIN, top)}px)`;
  });

  if (!state) {
    return null;
  }

  return createPortal(
    <div
      ref={bubbleRef}
      role="tooltip"
      className="pointer-events-none fixed left-0 top-0 z-50 w-max max-w-72 rounded-lg border border-border bg-popover/95 px-3 py-2 text-xs text-popover-foreground shadow-2xl shadow-black/40 backdrop-blur"
    >
      {state.content}
    </div>,
    document.body,
  );
}

export function ChartTooltipProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TooltipState | null>(null);

  const api = useMemo<TooltipApi>(
    () => ({
      show: (position, content) =>
        setState({
          x: position.clientX,
          y: position.clientY,
          content,
          anchor: position.currentTarget,
        }),
      move: (position) =>
        setState((current) =>
          current
            ? { ...current, x: position.clientX, y: position.clientY }
            : current,
        ),
      hide: () => setState(null),
    }),
    [],
  );

  // An anchor can unmount while hovered (view switch), which never fires
  // mouseleave, so close as soon as the pointer is no longer over it.
  const anchor = state?.anchor ?? null;
  useEffect(() => {
    if (!anchor) {
      return;
    }

    const onPointerMove = (event: PointerEvent) => {
      if (!anchor.isConnected || !(event.target instanceof Node && anchor.contains(event.target))) {
        setState(null);
      }
    };
    document.addEventListener("pointermove", onPointerMove);
    return () => document.removeEventListener("pointermove", onPointerMove);
  }, [anchor]);

  return (
    <ChartTooltipContext.Provider value={api}>
      {children}
      <TooltipBubble state={state} />
    </ChartTooltipContext.Provider>
  );
}

/**
 * Mouse handlers that show a tooltip while hovering. `content` runs on enter
 * only, so large grids stay cheap to render.
 */
export function useTooltipBinding(): (content: () => ReactNode) => {
  onMouseEnter: (event: React.MouseEvent) => void;
  onMouseMove: (event: React.MouseEvent) => void;
  onMouseLeave: () => void;
} {
  const api = useContext(ChartTooltipContext);
  if (!api) {
    throw new Error("useTooltipBinding needs a ChartTooltipProvider.");
  }

  return (content) => ({
    onMouseEnter: (event) => api.show(event, content()),
    onMouseMove: (event) => api.move(event),
    onMouseLeave: () => api.hide(),
  });
}
