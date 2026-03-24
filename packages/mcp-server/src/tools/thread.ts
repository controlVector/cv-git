/**
 * Thread workflow tools — stub until thread module is implemented in core.
 */

export interface CreateThreadArgs {
  title: string;
  repo_id?: string;
  description?: string;
}

export interface ListThreadsArgs {
  status?: string;
  repo_id?: string;
}

export interface GetThreadSummaryArgs {
  thread_id: string;
}

export interface UpdateThreadStatusArgs {
  thread_id: string;
  status: string;
}

export interface AddSegmentArgs {
  thread_id: string;
  platform: string;
  session_id?: string;
  goal?: string;
  context_snapshot?: string;
}

export interface EndSegmentArgs {
  segment_id: string;
  thread_id: string;
  summary?: string;
  files_changed?: string[];
  commits?: string[];
}

export interface BridgeContextArgs {
  thread_id: string;
  from_segment_id: string;
  to_segment_id?: string;
  context_type?: string;
  payload?: string;
}

export interface GetPendingBridgesArgs {
  thread_id: string;
  target_segment_id?: string;
}

const notImplemented = (name: string) => ({
  content: [{ type: 'text' as const, text: `${name} is not yet implemented. Thread module coming soon.` }],
});

export async function handleCreateThread(_args: CreateThreadArgs) {
  return notImplemented('cv_thread_create');
}

export async function handleListThreads(_args: ListThreadsArgs) {
  return notImplemented('cv_thread_list');
}

export async function handleGetThreadSummary(_args: GetThreadSummaryArgs) {
  return notImplemented('cv_thread_summary');
}

export async function handleUpdateThreadStatus(_args: UpdateThreadStatusArgs) {
  return notImplemented('cv_thread_status');
}

export async function handleAddSegment(_args: AddSegmentArgs) {
  return notImplemented('cv_thread_add_segment');
}

export async function handleEndSegment(_args: EndSegmentArgs) {
  return notImplemented('cv_thread_end_segment');
}

export async function handleBridgeContext(_args: BridgeContextArgs) {
  return notImplemented('cv_thread_bridge');
}

export async function handleGetPendingBridges(_args: GetPendingBridgesArgs) {
  return notImplemented('cv_thread_pending_bridges');
}
