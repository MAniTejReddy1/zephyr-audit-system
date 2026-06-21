import React from 'react';
import { CheckCircle2, XCircle, AlertTriangle, PauseCircle, SkipForward, MinusCircle, CheckCircle } from 'lucide-react';

export const STATUS_ICONS = {
  pass: <CheckCircle2 size={14} />,
  pass_flaky: <CheckCircle size={14} />, // Using a slightly different checkmark for flaky
  fail: <XCircle size={14} />,
  hold: <PauseCircle size={14} />,
  blocked: <AlertTriangle size={14} />,
  skip: <SkipForward size={14} />,
  na: <MinusCircle size={14} />,
  pending: null
};

export const STATUS_COLORS = {
  pass: 'var(--green)',
  pass_flaky: 'var(--amber)', // Using amber for flaky, as per PRD for warning/pending
  fail: 'var(--red)',
  hold: 'var(--yellow)',
  blocked: 'var(--red)',
  skip: 'var(--text-muted)',
  na: 'var(--text-dim)',
  pending: 'var(--text-dim)'
};

export const STATUS_LABELS = {
  pass: 'Pass',
  pass_flaky: 'Pass (Flaky)', // New label
  fail: 'Fail',
  hold: 'Hold',
  blocked: 'Blocked',
  skip: 'Skip',
  na: 'N/A',
  pending: 'Set status'
};