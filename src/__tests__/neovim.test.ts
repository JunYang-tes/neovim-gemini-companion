import { connectNewNeovim, isNeovimIdeCompanionBuffer, nvim, openFile } from '../neovim.js';
import { test, expect } from 'vitest'
import { resolve } from 'node:path'

test('isNeovimIdeCompanionBuffer', async () => {
  connectNewNeovim()
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

test('openFile', async () => {
  connectNewNeovim()
  let buf = await openFile(import.meta.filename)
  expect(buf).not.toBeNull()

  connectNewNeovim()
  const buffer = await nvim.buffer
  await buffer.setVar('is-neovim-ide-companion', true)
  buf = await openFile(import.meta.filename)
  expect(buf).not.toBeNull()

})
