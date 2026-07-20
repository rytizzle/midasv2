/**
 * Minimal word-level diff for the pre-vs-post metadata review.
 *
 * Produces a list of segments tagged equal / added / removed using a classic
 * LCS over whitespace-delimited tokens. Good enough for short comment strings;
 * no external dependency.
 */

export type DiffOp = 'equal' | 'added' | 'removed';

export interface DiffSegment {
  op: DiffOp;
  text: string;
}

function tokenize(s: string): string[] {
  // Keep whitespace as its own tokens so we can rejoin faithfully.
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

export function diffWords(before: string, after: string): DiffSegment[] {
  const a = tokenize(before ?? '');
  const b = tokenize(after ?? '');
  const n = a.length;
  const m = b.length;

  // LCS length table.
  const dp: number[][] = Array.from(
    { length: n + 1 },
    () => new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const segs: DiffSegment[] = [];
  const push = (op: DiffOp, text: string) => {
    const last = segs[segs.length - 1];
    if (last && last.op === op) last.text += text;
    else segs.push({ op, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('removed', a[i]);
      i++;
    } else {
      push('added', b[j]);
      j++;
    }
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);

  return segs;
}

/** True when there is any real (non-whitespace) difference. */
export function hasChange(before: string, after: string): boolean {
  return (before ?? '').trim() !== (after ?? '').trim();
}
