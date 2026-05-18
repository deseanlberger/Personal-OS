-- Template presets: let Desean keep multiple named schedules and switch them
-- with one tap. Use case: "School Year" template + "Summer" template that
-- swap when seasons change.

create table template_presets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'desean',
  name text not null,
  description text,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index template_presets_user_idx on template_presets(user_id);
alter table template_presets enable row level security;

-- Only one preset can be active at a time per user.
create unique index template_presets_one_active_per_user
  on template_presets(user_id) where is_active = true;

-- Add preset_id to block_templates so blocks belong to a preset.
alter table block_templates
  add column preset_id uuid references template_presets(id) on delete cascade;

-- Seed: create a "School Year" preset and assign all existing blocks to it.
do $$
declare
  default_preset_id uuid;
begin
  insert into template_presets (user_id, name, description, is_active)
  values ('desean', 'School Year', 'Original schedule with Lauren Feiler, Cohen Mugford, Tri-City sessions', true)
  returning id into default_preset_id;

  update block_templates
  set preset_id = default_preset_id
  where user_id = 'desean' and preset_id is null;
end $$;

-- Make preset_id required going forward
alter table block_templates alter column preset_id set not null;
create index block_templates_preset_idx on block_templates(preset_id);
