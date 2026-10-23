// Hand-written mirrors of the Pydantic models in backend/models/schemas.py.
// Keep the two in sync in the same edit — nothing infers across the HTTP boundary.

export interface User {
  id: string;
  email: string;
  name: string;
}

export type ConnectionState =
  | "not_connected"
  | "awaiting_auth"
  | "connecting"
  | "connected"
  | "partially_connected"
  | "insufficient_permissions"
  | "session_expired"
  | "connection_error";

export interface Employee {
  id: string;
  name: string;
  role: string;
  email: string;
}

export interface Company {
  id: string;
  name: string;
  segment: string;
  logo_url: string;
  employees: Employee[];
  created_at: string;
}

export interface Connection {
  company_id: string;
  state: ConnectionState;
  source: "" | "demo" | "real";
  provider: string;
  login_flow: string;
  ig_user_id: string;
  username: string;
  profile_pic: string;
  account_type: string;
  granted_scopes: string[];
  enabled_features: string[];
  webhooks: Record<string, boolean>;
  token_expires_at: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  error_hint: string | null;
  updated_at: string;
}

export interface ConnectionStatus {
  demo_mode: boolean;
  connection: Connection | null;
  required_scopes: string[];
  instagram_login_available: boolean;
  facebook_login_available: boolean;
}

export interface ConnectStartOut extends ConnectionStatus {
  authorization_url: string | null;
}

export interface PendingAccount {
  page_id: string;
  page_name: string;
  ig_user_id: string;
  username: string;
  profile_pic: string;
}

export interface PendingOut {
  pending_id: string;
  accounts: PendingAccount[];
}

export interface MediaItem {
  id: string;
  company_id: string;
  media_type: "image" | "video";
  url: string;
  name: string;
  created_at: string;
}

export type StoryStatus = "draft" | "scheduled" | "publishing" | "published" | "failed" | "canceled";

export interface Story {
  id: string;
  company_id: string;
  media_url: string;
  /** Fresh signed URL returned for private Supabase Storage media. */
  url?: string;
  media_type: "image" | "video";
  caption: string;
  schedule_at: string;
  status: StoryStatus;
  attempts: number;
  last_error: string | null;
  execution: string;
  platform_id: string;
  published_at: string | null;
  delete_at: string | null;
  delete_status: "not_scheduled" | "scheduled" | "deleting" | "deleted" | "failed";
  deleted_at: string | null;
  delete_error: string | null;
  created_at: string;
}

export interface StoryInsight {
  story_id: string;
  captured_at: string;
  impressions: number | null;
  reach: number | null;
  replies: number | null;
  exits: number | null;
  taps_forward: number | null;
  taps_back: number | null;
}

export interface Message {
  id: string;
  company_id: string;
  conversation_id: string;
  direction: "in" | "out";
  text: string;
  source: string;
  created_at: string;
}

export interface Note {
  id: string;
  text: string;
  author: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  company_id: string;
  contact_name: string;
  contact_username: string;
  avatar_color: string;
  status: "open" | "pending" | "resolved";
  assignee: string;
  tags: string[];
  notes: Note[];
  unread: number;
  last_message_at: string;
  created_at: string;
}

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface ConversationFollowUp {
  id: string;
  company_id: string;
  conversation_id: string;
  title: string;
  note: string;
  due_at: string;
  assigned_to: string;
  status: "pending" | "completed" | "cancelled";
  reminder_sent_at: string | null;
  created_by: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommentItem {
  id: string;
  company_id: string;
  post_id: string;
  post_caption: string;
  author: string;
  text: string;
  status: "new" | "replied" | "resolved";
  reply_text: string | null;
  replied_at: string | null;
  reply_source: string;
  source: string;
  created_at: string;
}

// Type alias (not interface) so it satisfies React Flow's Record<string, unknown> node-data constraint.
export type FlowNodeData = {
  kind: "trigger" | "condition" | "action";
  subtype: string;
  label: string;
  keyword?: string;
  text?: string;
  tag?: string;
  assignee?: string;
}

export interface FlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: FlowNodeData;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface Automation {
  id: string;
  company_id: string;
  name: string;
  description: string;
  enabled: boolean;
  nodes: FlowNode[];
  edges: FlowEdge[];
  runs: number;
  last_run_at: string | null;
  created_at: string;
}

export interface AutomationRun {
  id: string;
  company_id: string;
  automation_id: string;
  automation_name: string;
  trigger: string;
  matched_text: string;
  result: "executed" | "blocked" | "ended";
  detail: string;
  source: string;
  created_at: string;
}

export interface Task {
  id: string;
  company_id: string;
  title: string;
  source: string;
  done: boolean;
  created_at: string;
}

export type AssistantMode = "automatic" | "supervised" | "assisted";
export type KnowledgeEntryKind = "institutional" | "hours" | "service" | "course" | "event" | "price" | "promotion" | "faq" | "document";

export interface AiAssistant {
  id: string;
  company_id: string;
  name: string;
  personality: string;
  mode: AssistantMode;
  enabled: boolean;
  human_handoff_enabled: boolean;
  handoff_message: string;
  active_knowledge_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeBase {
  id: string;
  company_id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeVersion {
  id: string;
  company_id: string;
  knowledge_base_id: string;
  version_number: number;
  status: "draft" | "published" | "archived";
  published_at: string | null;
  published_by: string | null;
  created_at: string;
}

export interface KnowledgeEntry {
  id: string;
  company_id: string;
  knowledge_version_id: string;
  kind: KnowledgeEntryKind;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportTotals {
  stories_published: number;
  stories_scheduled: number;
  stories_failed: number;
  comments_received: number;
  messages_received: number;
  avg_response_minutes: number;
  atendimentos_concluidos: number;
  automations_executed: number;
}

export interface SeriesPoint {
  date: string;
  stories_published: number;
  comments: number;
  messages: number;
}

export interface ReportSummary {
  company_id: string;
  generated_at: string;
  demo_mode: boolean;
  totals: ReportTotals;
  series: SeriesPoint[];
  sources: Record<string, number>;
}

