"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during server rendering and hydration, true once React handles events.
 * Auth buttons driven by client calls stay disabled until then, so an early
 * click is never silently lost.
 */
export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
