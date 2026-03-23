/**
 * CV-Hub API Client
 *
 * HTTP client for communicating with the CV-Hub server.
 * Handles executor registration, task polling, thread continuity,
 * and result reporting.
 */

// ============================================================================
// Types
// ============================================================================

export interface HubClientConfig {
  /** CV-Hub API base URL (e.g. https://api.hub.controlvector.io) */
  baseUrl: string;

  /** Personal Access Token for authentication */
  token: string;

  /** Request timeout in ms (default: 30000) */
  timeout?: number;
}

export interface HubExecutor {
  id: string;
  name: string;
  type: string;
  status: string;
  workspace_root?: string;
  repository_id?: string;
  last_heartbeat_at?: string;
  last_task_at?: string;
  created_at: string;
  updated_at?: string;
  capabilities?: Record<string, unknown>;
}

export interface HubTask {
  id: string;
  title: string;
  description?: string;
  task_type: string;
  priority: number;
  status: string;
  input?: {
    prompt?: string;
    context?: string;
    files?: string[];
    repository_url?: string;
    branch?: string;
    environment?: Record<string, string>;
  };
  repository_id?: string;
  branch?: string;
  file_paths?: string[];
  thread_id?: string;
  parent_task_id?: string;
  timeout_at?: string;
  metadata?: Record<string, unknown>;

  // Result fields (populated after completion)
  result?: {
    summary?: string;
    filesModified?: string[];
    filesCreated?: string[];
    output?: string;
    artifacts?: Array<{ name: string; path: string; type: string }>;
  };
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface HubThread {
  id: string;
  title: string;
  description?: string;
  status: string;
  repository_id?: string;
  total_segments: number;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface HubSegment {
  id: string;
  thread_id: string;
  platform: string;
  segment_type: string;
  title?: string;
  session_identifier?: string;
  started_at: string;
  ended_at?: string;
  summary?: string;
  context_snapshot?: Record<string, unknown>;
  result_snapshot?: Record<string, unknown>;
  tools_used?: string[];
  files_touched?: string[];
}

export interface HubBridge {
  id: string;
  thread_id: string;
  from_segment_id: string;
  to_segment_id?: string;
  bridge_type: string;
  status: string;
  summary?: string;
  context_data?: Record<string, unknown>;
  key_decisions?: string[];
  task_ids?: string[];
  expires_at?: string;
}

// ============================================================================
// Client
// ============================================================================

export class HubClient {
  private baseUrl: string;
  private token: string;
  private timeout: number;

  constructor(config: HubClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
    this.timeout = config.timeout || 30000;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.token}`,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `CV-Hub API error (${response.status}): ${text}`,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ======================== Health ========================

  async isAvailable(): Promise<boolean> {
    try {
      await this.request<{ status: string }>('GET', '/health');
      return true;
    } catch {
      return false;
    }
  }

  // ======================== Executor ========================

  async registerExecutor(params: {
    name: string;
    type?: string;
    capabilities?: Record<string, unknown>;
    workspace_root?: string;
    repository_id?: string;
  }): Promise<{
    executor: HubExecutor;
    registration_token: string;
  }> {
    return this.request('POST', '/api/v1/executors', params);
  }

  async getExecutor(executorId: string): Promise<{ executor: HubExecutor }> {
    return this.request('GET', `/api/v1/executors/${executorId}`);
  }

  async listExecutors(): Promise<{ executors: HubExecutor[] }> {
    return this.request('GET', '/api/v1/executors');
  }

  async heartbeat(
    executorId: string,
  ): Promise<{ status: string; executor_status: string }> {
    return this.request('POST', `/api/v1/executors/${executorId}/heartbeat`);
  }

  async updateExecutorStatus(
    executorId: string,
    status: string,
  ): Promise<{ executor_id: string; status: string }> {
    return this.request(
      'PATCH',
      `/api/v1/executors/${executorId}/status`,
      { status },
    );
  }

  async unregisterExecutor(
    executorId: string,
  ): Promise<{ success: boolean }> {
    return this.request('DELETE', `/api/v1/executors/${executorId}`);
  }

  // ======================== Tasks ========================

  async createTask(params: {
    title: string;
    task_type: string;
    priority?: number;
    input?: {
      prompt?: string;
      context?: string;
      files?: string[];
    };
    thread_id?: string;
    parent_task_id?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ task: HubTask }> {
    return this.request('POST', '/api/v1/executors/tasks', params);
  }

  async getTask(taskId: string): Promise<{ task: HubTask }> {
    return this.request('GET', `/api/v1/executors/tasks/${taskId}`);
  }

  // ======================== Task Polling ========================

  async pollForTask(
    executorId: string,
  ): Promise<{ task: HubTask | null; message?: string }> {
    return this.request('POST', `/api/v1/executors/${executorId}/poll`);
  }

  async startTask(
    executorId: string,
    taskId: string,
  ): Promise<{ task_id: string; status: string; started_at: string }> {
    return this.request(
      'POST',
      `/api/v1/executors/${executorId}/tasks/${taskId}/start`,
    );
  }

  async completeTask(
    executorId: string,
    taskId: string,
    result: {
      summary?: string;
      files_modified?: string[];
      files_created?: string[];
      output?: string;
      artifacts?: Array<{ name: string; path: string; type: string }>;
    },
  ): Promise<{ task_id: string; status: string; completed_at: string }> {
    return this.request(
      'POST',
      `/api/v1/executors/${executorId}/tasks/${taskId}/complete`,
      result,
    );
  }

  async failTask(
    executorId: string,
    taskId: string,
    error: string,
  ): Promise<{
    task_id: string;
    status: string;
    completed_at: string;
    error: string;
  }> {
    return this.request(
      'POST',
      `/api/v1/executors/${executorId}/tasks/${taskId}/fail`,
      { error },
    );
  }

  // ======================== Task Events ========================

  async postTaskEvent(
    taskId: string,
    eventType: string,
    content: Record<string, unknown> | string,
    needsResponse?: boolean,
  ): Promise<Record<string, unknown>> {
    return this.request(
      'POST',
      `/api/v1/tasks/${taskId}/events`,
      {
        event_type: eventType,
        content,
        ...(needsResponse !== undefined ? { needs_response: needsResponse } : {}),
      },
    );
  }

  // ======================== Threads ========================

  async createThread(params: {
    title: string;
    description?: string;
    repository_id?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ thread: HubThread }> {
    return this.request('POST', '/api/v1/executors/threads', params);
  }

  async listThreads(params?: {
    status?: string;
    repository_id?: string;
    limit?: number;
  }): Promise<{ threads: HubThread[]; total: number }> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.repository_id) query.set('repository_id', params.repository_id);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.request('GET', `/api/v1/executors/threads${qs ? `?${qs}` : ''}`);
  }

  async getThreadSummary(threadId: string): Promise<Record<string, unknown>> {
    return this.request('GET', `/api/v1/executors/threads/${threadId}/summary`);
  }

  async updateThreadStatus(
    threadId: string,
    status: string,
  ): Promise<{ thread: HubThread }> {
    return this.request(
      'PATCH',
      `/api/v1/executors/threads/${threadId}/status`,
      { status },
    );
  }

  // ======================== Segments (via executor context) ========================

  async addSegment(params: {
    thread_id: string;
    platform: string;
    segment_type?: string;
    title?: string;
    session_identifier?: string;
    context_snapshot?: Record<string, unknown>;
    tools_used?: string[];
    files_touched?: string[];
    previous_segment_id?: string;
    edge_type?: string;
  }): Promise<{ segment: HubSegment }> {
    return this.request(
      'POST',
      `/api/v1/executors/threads/${params.thread_id}/segments`,
      params,
    );
  }

  async endSegment(params: {
    thread_id: string;
    segment_id: string;
    summary?: string;
    result_snapshot?: Record<string, unknown>;
    files_touched?: string[];
    tools_used?: string[];
  }): Promise<{ segment: HubSegment }> {
    return this.request(
      'POST',
      `/api/v1/executors/threads/${params.thread_id}/segments/${params.segment_id}/end`,
      params,
    );
  }

  // ======================== Context Bridges ========================

  async createBridge(params: {
    thread_id: string;
    from_segment_id: string;
    to_segment_id?: string;
    bridge_type?: string;
    summary?: string;
    context_data?: Record<string, unknown>;
    key_decisions?: string[];
    task_ids?: string[];
    expires_hours?: number;
  }): Promise<{ bridge: HubBridge }> {
    return this.request(
      'POST',
      `/api/v1/executors/threads/${params.thread_id}/bridges`,
      params,
    );
  }

  async getPendingBridges(
    threadId: string,
    segmentId?: string,
  ): Promise<{ bridges: HubBridge[] }> {
    const query = segmentId ? `?segment_id=${segmentId}` : '';
    return this.request(
      'GET',
      `/api/v1/executors/threads/${threadId}/bridges${query}`,
    );
  }
}
