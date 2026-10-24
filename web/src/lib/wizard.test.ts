import { describe, expect, it } from 'vitest';
import { simulatedApi } from './factory-sim';
import {
  blankDraft,
  bulletLines,
  fieldKey,
  fitSlug,
  requestBody,
  toPascal,
  toSlug,
  validateStep,
} from './wizard';

const info = await simulatedApi.info();

describe('wizard rules', () => {
  it('derives app name and identifier from free text', () => {
    expect(toPascal('Fleet portal 2')).toBe('FleetPortal2');
    expect(toSlug('Fleet Portal für Müller')).toBe('fleet-portal-fur-muller');
    expect(fitSlug('fleet-portal-for-dispatchers', 10)).toBe('fleet-porta'); // hyphens do not count
  });

  it('takes use cases from the bullets under a "need to do" heading only', () => {
    const text =
      '## Today\n- Excel sheet shared by mail\n\n## What they need to do\n- Dispatcher assigns a vehicle\n- Driver sees trips today\n\n## Rules\n- Company sign-in only';
    expect(bulletLines(text)).toEqual([
      'Dispatcher assigns a vehicle',
      'Driver sees trips today',
    ]);
  });

  it('requires a name and production reviewers', () => {
    const d = blankDraft(info);
    expect(validateStep(d, info, 0).appName).toBe('Give the app a name.');
    d.azure.production = true;
    expect(validateStep(d, info, 2).reviewers).toMatch(/reviewer/);
  });

  it('maps server error paths to wizard fields', () => {
    expect(fieldKey('github.productionReviewers[0]')).toBe('reviewers');
    expect(fieldKey('billing.costCenter')).toBe('costCenter');
  });

  it('builds a development-only request by default', () => {
    const d = {
      ...blankDraft(info),
      text: 'Visitor Desk',
      appName: 'VisitorDesk',
      slug: 'visitor-desk',
      repo: 'visitor-desk',
    };
    const r = requestBody(d, info);
    expect(r.azure.environments).toEqual(['development']);
    expect(r.github.productionReviewers).toEqual([]);
    expect(r.billing?.tier).toBe('sandbox');
  });
});
