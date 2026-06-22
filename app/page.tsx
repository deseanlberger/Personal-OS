import { Shell } from '@/components/dashboard/Shell';
import { Panel } from '@/components/dashboard/Panel';
import { CaptureBox } from '@/components/dashboard/CaptureBox';
import { SessionList } from '@/components/dashboard/SessionList';
import { KeyBlockersList } from '@/components/dashboard/KeyBlockersList';
import { CalendarCard } from '@/components/dashboard/CalendarCard';
import { HabitTracker } from '@/components/dashboard/HabitTracker';
import { Avatar } from '@/components/dashboard/Avatar';
import { NutritionCard } from '@/components/dashboard/NutritionCard';
import { GoalsCard } from '@/components/dashboard/GoalsCard';
import { SlippingCard } from '@/components/dashboard/SlippingCard';

export default function HomePage() {
  return (
    <Shell>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[280px_1fr_320px]">
        {/* LEFT COLUMN */}
        <div className="flex flex-col gap-4">
          <Panel id="01" title="Operator" meta={<span className="text-emerald-400">● ONLINE</span>}>
            <div className="flex items-center gap-3">
              <Avatar initials="DB" sizeClass="size-10" />
              <div>
                <div className="text-sm font-medium text-white/90">Desean Berger</div>
                <div className="text-[11px] text-white/40">Coach · Vista, CA</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 text-[11px] uppercase tracking-[0.18em] text-white/40">
              <div>
                <div>Focus</div>
                <div className="mt-1 text-sm font-normal normal-case tracking-normal text-white/80">
                  Ship Personal OS v1
                </div>
              </div>
              <div>
                <div>Streak</div>
                <div className="num mt-1 text-sm text-white/80">0 DAYS</div>
              </div>
            </div>
          </Panel>

          <Panel id="07" title="Finance Pulse" meta="LIVE">
            <div className="text-[10px] uppercase tracking-[0.18em] text-white/40">Net worth</div>
            <div className="num mt-1 text-3xl text-white/90">$—</div>
            <div className="mt-3 h-14 rounded bg-white/[0.03]" />
            <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
              <div>
                <div className="uppercase tracking-[0.18em] text-white/40">Daily</div>
                <div className="num mt-1 text-white/80">+$—</div>
              </div>
              <div>
                <div className="uppercase tracking-[0.18em] text-white/40">Monthly</div>
                <div className="num mt-1 text-white/80">+$—</div>
              </div>
            </div>
          </Panel>

          <Panel id="06" title="Key Blockers">
            <KeyBlockersList />
          </Panel>
        </div>

        {/* CENTER COLUMN */}
        <div className="flex flex-col gap-4">
          <Panel id="02" title="Session" meta="PT · UTC-8">
            <h2 className="text-2xl font-light text-white/90">
              Good evening, <span className="italic">Desean</span>.
            </h2>
            <div className="num mt-1 text-xs text-white/50">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </div>
            <div className="mt-4 text-[11px] uppercase tracking-[0.18em] text-white/40">
              Today I will
            </div>
            <input
              type="text"
              placeholder="Set today's one thing…"
              className="mt-1 w-full border-b border-white/10 bg-transparent py-2 text-sm text-white/80 outline-none placeholder-white/30 focus:border-emerald-400/40"
            />
            <div className="mt-4">
              <CaptureBox />
            </div>
            <div className="mt-6">
              <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-white/40">
                Top 3 today
              </div>
              <SessionList />
            </div>
          </Panel>

          <Panel id="03" title="Habits">
            <HabitTracker />
          </Panel>

          <Panel id="04" title="Calendar" meta="THIS WEEK">
            <CalendarCard />
          </Panel>
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex flex-col gap-4">
          <Panel id="08" title="Nutrition" meta="TODAY">
            <NutritionCard />
          </Panel>

          <Panel id="09" title="Goals" meta="PERSISTENT">
            <GoalsCard />
          </Panel>

          <SlippingCard />
        </div>
      </div>
    </Shell>
  );
}
