export type Urgency = 'today' | 'this_week' | 'this_month' | 'someday';
export type Category = 'deep-thinking' | 'deep-admin' | 'multitask-admin' | 'meeting' | 'personal' | 'flex';
export type Energy = 'high' | 'med' | 'low';

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  urgency: Urgency;
  key: boolean;
  priority_score: number;
  category: Category | null;
  energy: Energy | null;
  estimated_minutes: number | null;
  is_pinned: boolean;
  momentum_score: number;
  assigned_block_id: string | null;
  tags: string[];
  due_date: string | null;
  owner: string | null;
  entity_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
