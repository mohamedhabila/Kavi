// ---------------------------------------------------------------------------
// Tests — Approval Presentation (structured risk-reason-code classification)
// ---------------------------------------------------------------------------
// classifyReviewReason used to regex-match the human-readable riskReasons
// sentences. It now classifies purely from riskReasonCodes, a structured
// field the risk analyzer sets alongside each reason — these tests prove the
// category comes from the code, not from matching (or failing to match) text.

import { buildApprovalPresentation } from '../../src/components/approval/approvalPresentation';
import type { RemoteApprovalRequest } from '../../src/types/remote';
import {
  GRAPHEME_CLUSTER_FIXTURES,
  buildBoundaryStraddlingText,
  endsOnGraphemeBoundary,
  expectGraphemeSafe,
} from '../helpers/graphemeTestFixtures';

const DESCRIPTION_MAX_CHARS = 500;

const baseRequest = (
  overrides: Partial<RemoteApprovalRequest> = {},
): RemoteApprovalRequest => ({
  id: 'req-1',
  title: 'Run a command',
  description: 'Execute a shell command on the remote host.',
  status: 'pending',
  requestedAt: Date.now(),
  scope: 'ssh',
  decisionPolicy: { persistentApproval: 'forbidden', expiryFallback: 'reject' },
  ...overrides,
});

describe('buildApprovalPresentation reviewReason classification', () => {
  it('classifies destructive from the reason code, even when the prose omits the word', () => {
    const presentation = buildApprovalPresentation(
      baseRequest({
        riskReasons: ['Critical executable: rm'],
        riskReasonCodes: ['destructive_executable'],
      }),
    );
    expect(presentation.reviewReason).toBe('destructive');
  });

  it('classifies sensitiveData from sensitive_path', () => {
    const presentation = buildApprovalPresentation(
      baseRequest({
        riskReasons: ['Sensitive path: /etc/shadow'],
        riskReasonCodes: ['sensitive_path'],
      }),
    );
    expect(presentation.reviewReason).toBe('sensitiveData');
  });

  it('classifies compoundAction from compound_operators', () => {
    const presentation = buildApprovalPresentation(
      baseRequest({
        riskReasons: ['Command contains operators/pipes'],
        riskReasonCodes: ['compound_operators'],
      }),
    );
    expect(presentation.reviewReason).toBe('compoundAction');
  });

  it('classifies systemAccess from system_executable', () => {
    const presentation = buildApprovalPresentation(
      baseRequest({
        riskReasons: ['High-risk executable: sudo'],
        riskReasonCodes: ['system_executable'],
      }),
    );
    expect(presentation.reviewReason).toBe('systemAccess');
  });

  it('classifies unverified from code_execution', () => {
    const presentation = buildApprovalPresentation(
      baseRequest({
        riskReasons: ['Runs model-written code in the app runtime'],
        riskReasonCodes: ['code_execution'],
      }),
    );
    expect(presentation.reviewReason).toBe('unverified');
  });

  it('prioritizes destructive over a lower-severity code on the same request', () => {
    const presentation = buildApprovalPresentation(
      baseRequest({
        riskReasons: ['Medium-risk executable: git', 'Destructive flag/operator: --force'],
        riskReasonCodes: ['system_executable', 'destructive_operation'],
      }),
    );
    expect(presentation.reviewReason).toBe('destructive');
  });

  it('ignores prose that used to be sniffed when no reasonCodes are present', () => {
    const presentation = buildApprovalPresentation(
      baseRequest({
        riskReasons: ['Critical executable: rm — this is destructive and touches sensitive data'],
      }),
    );
    expect(presentation.reviewReason).toBeUndefined();
  });

  it('leaves reviewReason undefined for a request with no risk reasons at all', () => {
    const presentation = buildApprovalPresentation(baseRequest());
    expect(presentation.reviewReason).toBeUndefined();
  });
});

describe('buildApprovalPresentation description grapheme safety', () => {
  for (const { name, cluster } of GRAPHEME_CLUSTER_FIXTURES) {
    it(`never splits ${name} straddling the ${DESCRIPTION_MAX_CHARS}-char description budget`, () => {
      const longDescription = buildBoundaryStraddlingText(DESCRIPTION_MAX_CHARS, cluster, 40);
      const presentation = buildApprovalPresentation(
        baseRequest({ description: longDescription }),
      );

      expect(presentation.description.length).toBeLessThan(longDescription.length);
      expectGraphemeSafe(presentation.description);
      expect(endsOnGraphemeBoundary(longDescription, presentation.description)).toBe(true);
    });
  }
});
