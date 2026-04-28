"use client";
import { DashboardFilter, useDashboardFilter } from "./dashboard-content";

export function DashboardShell({
  availableModules,
  children,
}: {
  availableModules: string[];
  children: (activeViews: string[]) => React.ReactNode;
}) {
  const { activeViews, toggle, selectAll } = useDashboardFilter(availableModules);
  return (
    <>
      <DashboardFilter
        availableModules={availableModules}
        activeViews={activeViews}
        onToggle={toggle}
        onSelectAll={selectAll}
      />
      {children(activeViews)}
    </>
  );
}