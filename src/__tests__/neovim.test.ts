import { isNeovimIdeCompanionBuffer, nvim } from '../neovim.js';
import { test, expect } from 'vitest'

test('isNeovimIdeCompanionBuffer', async () => {
  const buffer = await nvim.buffer
  const r = await isNeovimIdeCompanionBuffer(buffer)
  expect(r).toBe(false)
  await buffer.setVar('is-neovim-ide-companion', true)
  expect(await isNeovimIdeCompanionBuffer(buffer)).toBe(true)
  await buffer.setVar('is-neovim-ide-companion', false)
  expect(await isNeovimIdeCompanionBuffer(buffer)).toBe(false)
  await buffer.setVar("neovim-ide-companion-ts", 1)
  expect(await isNeovimIdeCompanionBuffer(buffer)).toBe(true)
});
