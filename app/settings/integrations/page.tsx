import { Shell } from '@/components/dashboard/Shell';

const API_SECRET_DOCS = 'Your x-api-secret env var (server-only).';

export default function IntegrationsPage() {
  // Vercel exposes the prod URL; this page is read-only and we hard-code it.
  const PROD_URL = 'https://personal-os-woad.vercel.app';

  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="pb-2">
          <h1 className="font-mono text-xs uppercase tracking-[0.18em] text-white/40">
            Settings // Integrations
          </h1>
        </header>

        {/* Telegram */}
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-white/85">Telegram → Jarvis bot</h2>
            <span className="rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-emerald-300">
              live
            </span>
          </div>
          <p className="mt-1 text-[12px] text-white/55">
            Send Jarvis text, voice, OR food photos. Text/voice = task or note capture (auto-classified, auto-scheduled).
            Photo = nutrition log (AI estimates macros and adds to today).
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-white/40">
            <li>Bot: <code className="text-white/70">@Desean_os_capture_bot</code></li>
            <li>Webhook: <code className="text-white/70">/api/telegram/webhook</code> (already registered)</li>
            <li>Slash commands: <code className="text-white/70">/start</code>, <code className="text-white/70">/help</code>, <code className="text-white/70">/ping</code></li>
          </ul>
        </section>

        {/* Apple Health */}
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-white/85">Apple Health → daily sync</h2>
            <span className="rounded border border-amber-300/30 bg-amber-300/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-amber-300">
              shortcut required
            </span>
          </div>
          <p className="mt-1 text-[12px] text-white/55">
            iOS Safari can&apos;t read HealthKit. The workaround is a one-time iOS Shortcut that queries your steps + active calories
            and POSTs them to this endpoint daily. After 5 min of setup, it runs forever.
          </p>

          <details className="mt-3">
            <summary className="cursor-pointer text-[12px] font-medium text-emerald-300/85 hover:text-emerald-300">
              Step-by-step Shortcut setup (~5 min)
            </summary>
            <div className="mt-3 space-y-3 text-[12px] text-white/70">
              <div>
                <div className="font-medium text-white/85">1. Open the Shortcuts app on your iPhone</div>
                <div className="mt-0.5 text-[11px] text-white/40">
                  Built into iOS. If you can&apos;t find it, swipe down on home screen and search &quot;Shortcuts.&quot;
                </div>
              </div>

              <div>
                <div className="font-medium text-white/85">2. Tap + (top right) → name it &quot;Sync Health to OS&quot;</div>
              </div>

              <div>
                <div className="font-medium text-white/85">3. Add these actions in order (tap +Add Action between each):</div>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-[11px] text-white/55">
                  <li>
                    <strong>Find Health Samples</strong> → Sample Type = <em>Step Count</em>, Date = <em>is today</em>, Sort = newest first
                  </li>
                  <li>
                    <strong>Get Statistic</strong> → Type = <em>Sum</em>, of the Health Samples above
                  </li>
                  <li>
                    <strong>Set Variable</strong> → Name = <em>steps</em>, Value = the Statistic
                  </li>
                  <li>
                    <strong>Find Health Samples</strong> → Sample Type = <em>Active Energy Burned</em>, Date = <em>is today</em>
                  </li>
                  <li>
                    <strong>Get Statistic</strong> → Type = <em>Sum</em>
                  </li>
                  <li>
                    <strong>Set Variable</strong> → Name = <em>active_calories</em>
                  </li>
                  <li>
                    <strong>Get Contents of URL</strong> → URL = <code className="rounded bg-black/40 px-1">{PROD_URL}/api/health/sync</code>
                  </li>
                </ol>
              </div>

              <div>
                <div className="font-medium text-white/85">4. For the Get Contents of URL action, tap &quot;Show More&quot;:</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-[11px] text-white/55">
                  <li>Method: <strong>POST</strong></li>
                  <li>Headers: add <code className="text-white/70">x-api-secret</code> = <em className="text-white/40">{API_SECRET_DOCS}</em> (I&apos;ll paste it in chat when you&apos;re ready)</li>
                  <li>Request Body: <strong>JSON</strong></li>
                  <li>Add a key <code className="text-white/70">steps</code> (Number) → pick variable <em>steps</em></li>
                  <li>Add a key <code className="text-white/70">active_calories</code> (Number) → pick variable <em>active_calories</em></li>
                </ul>
              </div>

              <div>
                <div className="font-medium text-white/85">5. Tap Done. Run it once manually to test.</div>
                <div className="mt-0.5 text-[11px] text-white/40">
                  iOS will ask for permission to read HealthKit + send web requests. Allow both.
                </div>
              </div>

              <div>
                <div className="font-medium text-white/85">6. (Optional) Automate it</div>
                <div className="mt-0.5 text-[11px] text-white/55">
                  Shortcuts app → Automation tab → + → Time of Day → 11:00 PM → Run Shortcut → pick &quot;Sync Health to OS&quot; →
                  toggle <em>Run Immediately</em> on. Now it auto-syncs every night.
                </div>
              </div>
            </div>
          </details>

          <p className="mt-3 text-[11px] text-white/40">
            Tested fields: <code>steps</code>, <code>active_calories</code>, <code>resting_calories</code>, <code>distance_mi</code>,
            <code>exercise_min</code>, <code>resting_hr</code>, <code>hrv_ms</code>, <code>weight_lb</code>. Send any you want tracked.
          </p>
        </section>

        {/* Google Calendar push */}
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 opacity-60">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-white/85">Google Calendar push</h2>
            <span className="text-[9px] uppercase tracking-[0.18em] text-white/30">soon</span>
          </div>
          <p className="mt-1 text-[12px] text-white/55">
            Push your weekly blocks + auto-assigned tasks to your real Google Calendar so phone notifications still work.
            Needs a one-time OAuth setup.
          </p>
        </section>

        {/* Finance Google Sheet */}
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 opacity-60">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-white/85">Finance Google Sheet → AI extraction</h2>
            <span className="text-[9px] uppercase tracking-[0.18em] text-white/30">soon</span>
          </div>
          <p className="mt-1 text-[12px] text-white/55">
            Read your accounts spreadsheet daily, Claude extracts net worth + category breakdown. Service account auth, sheet stays private.
          </p>
        </section>
      </div>
    </Shell>
  );
}
