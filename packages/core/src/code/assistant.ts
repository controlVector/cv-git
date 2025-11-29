/**
 * CV Code - Code Assistant
 *
 * Main orchestration class for the AI coding assistant
 * Coordinates context, AI, editing, and session management
 */

import { v4 as uuidv4 } from 'uuid';
import { VectorManager } from '../vector/index.js';
import { GraphManager } from '../graph/index.js';
import { GitManager } from '../git/index.js';
import { AIClient } from '../ai/types.js';
import { ContextManager, createContextManager } from './context-manager.js';
import { SessionManager, createSessionManager } from './session-manager.js';
import { FileOperations, createFileOperations } from './file-ops.js';
import { EditParser, createEditParser } from './edit-parser.js';
import {
  CodeSession,
  CodeMessage,
  CodeOptions,
  Edit,
  EditResult,
  ProcessResult,
  CodeCallbacks,
  CodePhase,
  ContextSnapshot,
  FileDiff,
} from './types.js';

/**
 * System prompt for code editing
 */
const CODE_SYSTEM_PROMPT = `You are an expert software engineer assistant integrated into a code editing tool called CV-Git.

## Your Capabilities

You have access to:
1. **Code context** - Relevant files and code snippets from the codebase are provided below
2. **File modifications** - You can create, modify, and delete files using special edit blocks
3. **Codebase knowledge** - The context includes semantically relevant code based on the user's query

When the user asks questions about the codebase, answer based on the context provided below. If you need more context about specific files, tell the user which files you'd like to see.

## Instructions for Making Changes

When you need to modify code, use the following format:

### For new files:
\`\`\`path/to/newfile.ts
// Full file content here
\`\`\`

### For modifications (search/replace):
\`\`\`path/to/existing.ts
<<<<<<< SEARCH
// Exact code to find (must match exactly, including whitespace)
=======
// Code to replace it with
>>>>>>> REPLACE
\`\`\`

You can include multiple SEARCH/REPLACE blocks in a single file block.

### For file deletions:
\`\`\`path/to/delete.ts
<<<<<<< DELETE
>>>>>>> DELETE
\`\`\`

### For file renames:
\`\`\`old/path.ts → new/path.ts
\`\`\`

## Important Guidelines

1. **SEARCH blocks must match exactly** - including all whitespace and indentation
2. **Make minimal changes** - only modify what's necessary for the task
3. **Explain your changes** - describe what you're doing before showing edit blocks
4. **One logical change per edit** - keep edits focused and reviewable
5. **Preserve existing style** - match the coding style of the file
6. **Answer questions directly** - if the user asks about code, answer based on context below

## Current Codebase Context

The following code context is provided to help you understand the codebase:
`;

/**
 * Main Code Assistant class
 */
export class CodeAssistant {
  private session: SessionManager;
  private context: ContextManager;
  private fileOps: FileOperations;
  private editParser: EditParser;
  private aiClient: AIClient;
  private repoRoot: string;
  private options: CodeOptions;

  constructor(
    repoRoot: string,
    vector: VectorManager | null,
    graph: GraphManager | null,
    git: GitManager,
    aiClient: AIClient,
    options: CodeOptions = {}
  ) {
    this.repoRoot = repoRoot;
    this.options = options;
    this.aiClient = aiClient;

    // Debug: Check graph state when passed to CodeAssistant
    if (process.env.CV_DEBUG && graph) {
      console.log(`[CodeAssistant] Received graph: connected=${graph.isConnected()}`);
    }

    this.session = createSessionManager(repoRoot);
    this.context = createContextManager(
      vector,
      graph,
      repoRoot,
      options.contextLimit || 100000
    );
    this.fileOps = createFileOperations(repoRoot);
    this.editParser = createEditParser();
  }

  /**
   * Initialize or resume a session
   */
  async initSession(
    branch: string,
    commitSha: string,
    resumeId?: string
  ): Promise<CodeSession> {
    if (resumeId) {
      return this.session.resumeSession(resumeId);
    }
    return this.session.getOrCreateSession(branch, commitSha);
  }

  /**
   * Get current session
   */
  getSession(): CodeSession | null {
    return this.session.getCurrentSession();
  }

  /**
   * Process a user message and return AI response with edits
   */
  async processMessage(
    userMessage: string,
    callbacks?: CodeCallbacks
  ): Promise<ProcessResult> {
    const currentSession = this.session.getCurrentSession();
    if (!currentSession) {
      throw new Error('No active session. Call initSession first.');
    }

    // 1. Build context for this message
    callbacks?.onStatus?.('searching', 'Searching codebase...');
    const contextSnapshot = await this.context.buildContext(
      userMessage,
      currentSession.activeContext,
      {
        maxChunks: 15,
        minScore: 0.5,
      }
    );

    // 2. Build system prompt with context
    const systemPrompt = this.buildSystemPrompt(contextSnapshot);

    // 3. Build message history
    const messages = this.buildMessageHistory(
      currentSession,
      userMessage,
      contextSnapshot
    );

    // 4. Stream AI response
    callbacks?.onStatus?.('thinking', 'Thinking...');
    let fullResponse = '';
    let hasStartedGenerating = false;

    try {
      await this.aiClient.chatStream(messages, systemPrompt, {
        onToken: (token) => {
          if (!hasStartedGenerating) {
            hasStartedGenerating = true;
            callbacks?.onStatus?.('generating', 'Generating response...');
          }
          fullResponse += token;
          callbacks?.onToken?.(token);
        },
        onComplete: (response) => {
          callbacks?.onComplete?.(response);
        },
        onError: (error) => {
          callbacks?.onError?.(error);
        },
      });
    } catch (error: any) {
      callbacks?.onError?.(error);
      throw error;
    }

    // 5. Parse edits from response
    callbacks?.onStatus?.('parsing', 'Parsing edits...');
    const messageId = uuidv4();
    const edits = this.editParser.parseResponse(fullResponse, messageId);

    // 6. Update session
    const userMsg: CodeMessage = {
      id: uuidv4(),
      role: 'user',
      content: userMessage,
      timestamp: Date.now(),
      contextSnapshot,
    };

    const assistantMsg: CodeMessage = {
      id: messageId,
      role: 'assistant',
      content: fullResponse,
      timestamp: Date.now(),
      extractedEdits: edits,
    };

    this.session.addMessage(userMsg);
    this.session.addMessage(assistantMsg);

    // Add edits to pending
    if (edits.length > 0) {
      this.session.addPendingEdits(edits);

      // Notify about each edit
      for (const edit of edits) {
        callbacks?.onEdit?.(edit);
      }
    }

    // Update token count
    this.session.updateTokenCount(contextSnapshot.tokenCount);

    // Save session
    await this.session.save();

    callbacks?.onStatus?.('done');

    return {
      response: fullResponse,
      edits,
      contextSnapshot,
    };
  }

  /**
   * Build system prompt with context
   */
  private buildSystemPrompt(context: ContextSnapshot): string {
    const contextFormatted = this.context.formatForPrompt(context);
    return CODE_SYSTEM_PROMPT + '\n' + contextFormatted;
  }

  /**
   * Build message history for AI call
   */
  private buildMessageHistory(
    session: CodeSession,
    userMessage: string,
    context: ContextSnapshot
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Include recent conversation history (last 10 messages)
    const recentMessages = session.messages.slice(-10);
    for (const msg of recentMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }

    // Add current message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    return messages;
  }

  /**
   * Apply pending edits
   */
  async applyEdits(options?: {
    editIds?: string[];
    autoApprove?: boolean;
  }): Promise<EditResult[]> {
    const pendingEdits = this.session.getPendingEdits();
    const results: EditResult[] = [];

    const editsToApply = options?.editIds
      ? pendingEdits.filter((e) => options.editIds!.includes(e.id))
      : pendingEdits;

    for (const edit of editsToApply) {
      // Check if approved (or auto-approving)
      if (!options?.autoApprove && edit.status !== 'approved') {
        continue;
      }

      // Apply the edit
      const result = await this.fileOps.applyEdit(edit);
      results.push(result);

      if (result.success) {
        this.session.markEditApplied(result);
      }
    }

    // Save session
    await this.session.save();

    return results;
  }

  /**
   * Approve an edit (mark as ready to apply)
   */
  approveEdit(editId: string): boolean {
    const pendingEdits = this.session.getPendingEdits();
    const edit = pendingEdits.find((e) => e.id === editId);

    if (edit) {
      edit.status = 'approved';
      return true;
    }

    return false;
  }

  /**
   * Approve all pending edits
   */
  approveAllEdits(): number {
    const pendingEdits = this.session.getPendingEdits();
    let count = 0;

    for (const edit of pendingEdits) {
      if (edit.status === 'pending') {
        edit.status = 'approved';
        count++;
      }
    }

    return count;
  }

  /**
   * Reject an edit
   */
  rejectEdit(editId: string): boolean {
    const session = this.session.getCurrentSession();
    if (!session) return false;

    const editIndex = session.pendingEdits.findIndex((e) => e.id === editId);
    if (editIndex >= 0) {
      session.pendingEdits.splice(editIndex, 1);
      return true;
    }

    return false;
  }

  /**
   * Undo the last applied edit
   */
  async undoLastEdit(): Promise<boolean> {
    const lastApplied = this.session.popAppliedEdit();
    if (!lastApplied) {
      return false;
    }

    const success = await this.fileOps.revertEdit(lastApplied);

    if (success) {
      await this.session.save();
    }

    return success;
  }

  /**
   * Get pending edits
   */
  getPendingEdits(): Edit[] {
    return this.session.getPendingEdits();
  }

  /**
   * Generate diff for an edit
   */
  async generateDiff(edit: Edit): Promise<FileDiff> {
    let originalContent: string | undefined;

    if (edit.type !== 'create') {
      try {
        originalContent = await this.fileOps.readFile(edit.file);
      } catch {
        // File doesn't exist yet
      }
    }

    return this.editParser.generateDiff(edit, originalContent);
  }

  /**
   * Format diff for terminal display
   */
  formatDiffForDisplay(diff: FileDiff): string {
    return this.editParser.formatDiffForDisplay(diff);
  }

  /**
   * Add file to explicit context
   */
  addFile(filePath: string): void {
    const session = this.session.getCurrentSession();
    if (session) {
      this.context.addExplicitFile(session.activeContext, filePath);
    }
  }

  /**
   * Remove file from explicit context
   */
  dropFile(filePath: string): void {
    const session = this.session.getCurrentSession();
    if (session) {
      this.context.removeExplicitFile(session.activeContext, filePath);
    }
  }

  /**
   * Get context summary
   */
  getContextSummary(): string {
    const session = this.session.getCurrentSession();
    if (!session) return 'No active session';
    return this.context.getContextSummary(session.activeContext);
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.session.clearMessages();
  }

  /**
   * Clear pending edits
   */
  clearPendingEdits(): void {
    this.session.clearPendingEdits();
  }

  /**
   * Save current session
   */
  async saveSession(): Promise<void> {
    await this.session.save();
  }

  /**
   * List available sessions
   */
  async listSessions() {
    return this.session.listSessions();
  }

  /**
   * Get AI model info
   */
  getModel(): string {
    return this.aiClient.getModel();
  }

  /**
   * Set AI model
   */
  setModel(model: string): void {
    this.aiClient.setModel(model);
  }
}

/**
 * Create a CodeAssistant instance
 */
export function createCodeAssistant(
  repoRoot: string,
  vector: VectorManager | null,
  graph: GraphManager | null,
  git: GitManager,
  aiClient: AIClient,
  options?: CodeOptions
): CodeAssistant {
  return new CodeAssistant(repoRoot, vector, graph, git, aiClient, options);
}
