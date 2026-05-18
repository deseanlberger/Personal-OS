'use client';

import { useState } from 'react';
import { Shell } from '@/components/dashboard/Shell';
import { TasksKanban } from '@/components/crm/TasksKanban';
import { SmartSearch } from '@/components/crm/SmartSearch';
import { AddTaskInline } from '@/components/crm/AddTaskInline';

export default function CrmPage() {
  const [filterIds, setFilterIds] = useState<Set<string> | null>(null);

  return (
    <Shell>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-2 pb-2">
          <div className="flex items-baseline gap-3">
            <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">CRM // Database</h1>
          </div>
          <SmartSearch
            onResult={(ids) => setFilterIds(new Set(ids))}
            onClear={() => setFilterIds(null)}
          />
          <AddTaskInline />
        </header>

        {filterIds && (
          <div className="rounded-md border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-[11px] text-emerald-300/80">
            Showing {filterIds.size} task{filterIds.size === 1 ? '' : 's'} from your search.
          </div>
        )}

        <TasksKanban filterIds={filterIds} />
      </div>
    </Shell>
  );
}
