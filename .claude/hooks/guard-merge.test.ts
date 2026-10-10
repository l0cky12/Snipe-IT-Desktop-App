import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const hook = fileURLToPath(new URL('guard-merge.sh', import.meta.url))

// Stands in for gh: logs each call, answers from env vars. Only answers a later page of threads when the hook paginates.
const fakeGh = `#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "pr view") [[ -n \${VIEW_FAILS:-} ]] && { echo "network down" >&2; exit 1; }; echo "$VIEW" ;;
  "pr checks") exit "\${CHECKS_EXIT:-0}" ;;
  "repo view") echo "owner repo" ;;
  "api graphql") [[ " $* " == *" --paginate "* && $* == *'after: $endCursor'* ]] && printf '%b' "\${LATER_PAGE:-}" ;;
esac
`

const view = (labels: string[] = [], comment = '### Codex review (round 1)\n\nReviewed `abcdef1`.') =>
  JSON.stringify({ headRefOid: 'abcdef1234567', labels: labels.map((name) => ({ name })), comments: [{ body: comment }] })

function run(command: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'guard-merge-'))
  writeFileSync(join(dir, 'gh'), fakeGh)
  chmodSync(join(dir, 'gh'), 0o755)
  const log = join(dir, 'gh.log')
  writeFileSync(log, '')
  const result = spawnSync('bash', [hook], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, GH_LOG: log, VIEW: view(), ...env },
  })
  return { status: result.status, stderr: result.stderr, gh: readFileSync(log, 'utf8') }
}

describe.skipIf(process.platform === 'win32')('guard-merge hook', () => {
  it('lets a PR that meets the merge rule through, checking the PR it names', () => {
    for (const command of ['gh pr merge 202 --squash', 'cd x && gh pr merge 202', 'GH_TOKEN=$(gh auth token --user me) gh pr merge 202 --squash']) {
      const { status, gh } = run(command)
      expect(status, command).toBe(0)
      expect(gh).toMatch(/^pr view 202 /m)
      expect(gh).toMatch(/^pr checks 202$/m)
    }
  })

  it('blocks until every condition holds', () => {
    expect(run('gh pr merge 202', { VIEW: view(['security-sensitive']) })).toMatchObject({ status: 2, stderr: expect.stringMatching(/labelled security-sensitive/) })
    expect(run('gh pr merge 202', { VIEW: view(['needs-human-review']) })).toMatchObject({ status: 2, stderr: expect.stringMatching(/labelled needs-human-review/) })
    expect(run('gh pr merge 202', { VIEW: view([], '### Codex review (round 1)\n\nReviewed `0000000`.') })).toMatchObject({ status: 2, stderr: expect.stringMatching(/latest commit abcdef1/) })
    expect(run('gh pr merge 202', { CHECKS_EXIT: '8' })).toMatchObject({ status: 2, stderr: expect.stringMatching(/checks aren't all green/) })
    expect(run('gh pr merge 202', { LATER_PAGE: '1\\n' })).toMatchObject({ status: 2, stderr: expect.stringMatching(/1 unresolved review thread/) })
  })

  it('blocks when a check fails to run', () => {
    expect(run('gh pr merge 202', { VIEW_FAILS: '1' })).toMatchObject({ status: 2, stderr: expect.stringMatching(/a check failed/) })
  })

  it("blocks merges it can't check exactly, without asking gh", () => {
    for (const command of [
      'gh pr merge',
      'gh pr merge --squash 202',
      'gh pr merge https://github.com/owner/repo/pull/202',
      'gh pr merge some-branch',
      'gh pr merge 202 -R other/repo',
      'GH_REPO=other/repo gh pr merge 202',
      'gh pr merge 76 && gh pr merge 202',
    ]) {
      const { status, gh } = run(command)
      expect(status, command).toBe(2)
      expect(gh, command).toBe('')
    }
  })

  it('ignores commands that only mention merging', () => {
    for (const command of ['git commit -m "blocks `gh pr merge` until"', 'echo gh pr merge 202', 'gh pr view 202']) {
      expect(run(command), command).toEqual({ status: 0, stderr: '', gh: '' })
    }
  })
})
