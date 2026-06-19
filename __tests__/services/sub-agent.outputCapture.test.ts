import {
  installSubAgentTestHarness,
  makeStructuredFinalizerResponse,
  mockProvider,
  sendMessageSpy,
  spawnSubAgent,
} from '../helpers/subAgentHarness';

describe('Sub-Agent Service', () => {
  installSubAgentTestHarness();

  describe('spawnSubAgent — output capture for tool-only responses', () => {
    it('synthesizes a final worker report when a tool phase ends without terminal text', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'Final report: files reviewed and changes are ready.',
          'incomplete',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        // First iteration: assistant produces text + tool call
        callbacks.onToken?.('Initial analysis: ');
        callbacks.onAssistantMessage?.('Initial analysis: reviewing files');
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        // Second iteration: only tool calls (no text tokens) — typical for Claude
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'write_file' });
        callbacks.onToolCallComplete?.();
        // onDone without final text
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'tool heavy task' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.output).toBe('Final report: files reviewed and changes are ready.');
      expect(sendMessageSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to prior visible worker text if the finalization pass fails', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockRejectedValueOnce(new Error('finalizer failed'));
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Initial analysis: reviewing files');
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'write_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'tool heavy task' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.output).toBe('Initial analysis: reviewing files');
    });

    it('synthesizes output from tool-only iterations', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'Final report: repository scan completed and matching files were found.',
          'incomplete',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        // All iterations produce only tool calls — no text at all
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'text_search' });
        callbacks.onToolCallComplete?.();
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'silent tools' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.output).toBe(
        'Final report: repository scan completed and matching files were found.',
      );
    });

    it('synthesizes output with status info on timeout with tool-only responses', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        // Simulate tool calls then abort
        callbacks.onAssistantMessage?.('');
        callbacks.onToolCallStart?.({ name: 'web_search' });
        callbacks.onToolCallComplete?.();
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'complex query', timeoutMs: 50 },
        mockProvider,
      );

      expect(result.status).toBe('timeout');
      expect(result.output).toContain('Sub-agent timeout');
      expect(result.output).toContain('web_search');
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('prefers the terminal assistant answer over earlier planning text', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Plan: inspect files first.', [
          { id: 'tc1', name: 'read_file', arguments: '{}', status: 'pending' },
        ]);
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onToken?.('Final answer: all checks passed.');
        callbacks.onAssistantMessage?.('Final answer: all checks passed.', []);
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        { parentConversationId: 'p', prompt: 'complete the task' },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.output).toBe('Final answer: all checks passed.');
    });

    it('marks terminal worker prose incomplete when execution-backed work omits completion_state', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Plan: update the artifact.', [
          { id: 'tc1', name: 'file_edit', arguments: '{}', status: 'pending' },
        ]);
        callbacks.onToolCallStart?.({ name: 'file_edit' });
        callbacks.onToolCallComplete?.({
          id: 'tc1',
          name: 'file_edit',
          result: 'Updated src/App.tsx and saved changes.',
          status: 'completed',
        });
        callbacks.onAssistantMessage?.('Final answer: artifact updated.', []);
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-terminal-evidence',
          workstreamId: 'edit',
          prompt: 'Update src/App.tsx and verify the artifact.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Final answer: artifact updated.');
      expect(result.output).not.toContain('completion_state:');
      expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    it('blocks success claims for execution tasks when no commit/push/deploy evidence exists', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse('تم النشر بنجاح.', 'verified_success') as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Investigating files only');
        callbacks.onToolCallStart?.({ name: 'read_file' });
        callbacks.onToolCallComplete?.();
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-exec-no-evidence',
          workstreamId: 'deploy',
          prompt: 'Create app, commit, push, and deploy until green.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('blocked');
      expect(result.output).toBe('تم النشر بنجاح.');
    });

    it('preserves verified_success inspection output for ad hoc workers tracked only by agentRunId', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          '- package.json: missing\n- README.md: missing\n- workspace: empty',
          'verified_success',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Inspecting the workspace');
        callbacks.onToolCallStart?.({ name: 'list_files' });
        callbacks.onToolCallComplete?.({
          name: 'list_files',
          result: '(empty directory)',
        });
        callbacks.onToolCallStart?.({ name: 'glob_search', arguments: '{"pattern":"*"}' });
        callbacks.onToolCallComplete?.({
          name: 'glob_search',
          result: 'No files matched "*" under .',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-ad-hoc-inspection',
          prompt: 'Inspect the workspace for package.json and README.md.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('verified_success');
      expect(result.output).toContain('- package.json: missing');
      expect(result.output).not.toContain('completion_state:');
    });

    it('keeps execution-backed worker reports incomplete when finalization does not certify completion', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'Deployment succeeded on workflow run 101.',
          'incomplete',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Monitoring workflow');
        callbacks.onToolCallStart?.({ name: 'expo_eas_workflow_status' });
        callbacks.onToolCallComplete?.({
          name: 'expo_eas_workflow_status',
          result: 'workflow run 101 completed with success',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-expo-evidence',
          workstreamId: 'deploy',
          prompt: 'Create app, commit, push, and deploy until green.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Deployment succeeded on workflow run 101.');
    });

    it('keeps artifact-edit worker reports incomplete when finalization does not certify completion', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'Updated the requested app shell file.',
          'incomplete',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Applying the requested code change');
        callbacks.onToolCallStart?.({ name: 'file_edit' });
        callbacks.onToolCallComplete?.({
          name: 'file_edit',
          result: 'Updated src/App.tsx and saved changes.',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-artifact-evidence',
          workstreamId: 'edit',
          prompt: 'Update src/App.tsx and save the fix.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Updated the requested app shell file.');
    });

    it('uses the most conservative state when worker reports contain contradictory completion states', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.(
          'completion_state: verified_success\nactions_taken: ["tool:file_edit"]\n\ncompletion_state: incomplete\n\nThe file changed, but verification did not run.',
        );
        callbacks.onToolCallStart?.({ name: 'file_edit' });
        callbacks.onToolCallComplete?.({
          name: 'file_edit',
          result: 'Updated src/App.tsx and saved changes.',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-contradictory-completion-state',
          workstreamId: 'mixed',
          prompt: 'Update src/App.tsx and run verification.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).not.toContain('completion_state: verified_success');
      expect(result.output).not.toContain('completion_state: incomplete');
      expect(result.output).toContain('The file changed, but verification did not run.');
    });

    it('does not self-certify verified_success after a max-iterations abort just because tool evidence exists', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse(
          'The worker completed the task successfully.',
          'verified_success',
        ) as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onToolCallStart?.({
          id: 'tc-1',
          name: 'write_file',
          arguments: '{"path":"graphbatchcheck.txt","content":"batch flow ok"}',
          status: 'running',
        });
        callbacks.onToolCallComplete?.({
          id: 'tc-1',
          name: 'write_file',
          status: 'completed',
          result: 'Wrote 13 chars to graphbatchcheck.txt',
        });
        const err = new Error('Aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-max-iterations-guardrail',
          workstreamId: 'graphbatchcheck',
          prompt: 'Create graphbatchcheck.txt with batch flow ok and verify it.',
          maxIterations: 1,
        },
        mockProvider,
      );

      expect(result.status).not.toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('The worker completed the task successfully.');
      expect(result.output).not.toContain('completion_state:');
    });

    it('keeps dynamic skill worker reports incomplete when finalization does not certify completion', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse('Release finished successfully.', 'incomplete') as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Running the release workflow');
        callbacks.onToolCallStart?.({ name: 'skill__acme_ops__release_delivery' });
        callbacks.onToolCallComplete?.({
          name: 'skill__acme_ops__release_delivery',
          result: 'Release deployment completed successfully.',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-dynamic-release',
          workstreamId: 'release',
          prompt: 'Run the release workflow and verify the deployment completed.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('incomplete');
      expect(result.output).toContain('Release finished successfully.');
    });

    it('keeps worker-reported blocked completion state separate from the visible report', async () => {
      const { runOrchestrator } = require('../../src/engine/orchestrator');
      sendMessageSpy.mockResolvedValueOnce(
        makeStructuredFinalizerResponse('Resultat final en attente.', 'blocked') as any,
      );
      runOrchestrator.mockImplementationOnce((_opts: any, callbacks: any) => {
        callbacks.onAssistantMessage?.('Monitoring workflow');
        callbacks.onToolCallStart?.({ name: 'expo_eas_workflow_status' });
        callbacks.onToolCallComplete?.({
          name: 'expo_eas_workflow_status',
          result: 'workflow run 101 failed with environment constraints',
        });
        callbacks.onDone?.();
        return Promise.resolve();
      });

      const result = await spawnSubAgent(
        {
          parentConversationId: 'p',
          agentRunId: 'run-expo-contradiction',
          workstreamId: 'deploy',
          prompt: 'Create app, commit, push, and deploy until green.',
        },
        mockProvider,
      );

      expect(result.status).toBe('completed');
      expect(result.completionState).toBe('blocked');
      expect(result.output).toBe('Resultat final en attente.');
    });
  });
});
