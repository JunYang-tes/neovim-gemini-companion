import { test, expect, vi } from 'vitest'
import { connectNewNeovim, nvim, openFile } from '../neovim.js'
import { writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let checkDocumentDirtyHandler: any;
let openFileHandler: any;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: vi.fn(() => {
      return {
        registerTool: (name: string, _schema: any, handler: any) => {
          if (name === 'checkDocumentDirty') {
            checkDocumentDirtyHandler = handler;
          }
          if (name === 'openFile') {
            openFileHandler = handler;
          }
        },
        server: {
          setRequestHandler: vi.fn(),
          setNotificationHandler: vi.fn(),
        },
        connect: vi.fn(),
      }
    })
  }
})

vi.mock('../log.js', () => {
  return {
    default: {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    }
  }
})

// Must import after mocks
import { ClaudeIdeServer } from '../claude.js';

// Initialize to register tools
new ClaudeIdeServer();


test('checkDocumentDirty', async () => {
  connectNewNeovim()

  const tempFile = path.join(os.tmpdir(), `test-claude-${Date.now()}.txt`)
  await writeFile(tempFile, 'hello world')

  try {
    // 1. Test when file is not open in neovim
    let result = await checkDocumentDirtyHandler({ filePath: tempFile })
    let parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.success).toBe(false)
    expect(parsedResult.message).toContain('Document not open')

    // 2. Test when file is open and not dirty
    const buf = await openFile(tempFile)
    expect(buf).not.toBeNull()

    result = await checkDocumentDirtyHandler({ filePath: tempFile })
    parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.success).toBe(true)
    expect(parsedResult.filePath).toBe(tempFile)
    expect(parsedResult.isDirty).toBe(false)

    // 3. Test when file is dirty
    await buf!.setLines(['modified content'], { start: 0, end: -1, strictIndexing: false })
    result = await checkDocumentDirtyHandler({ filePath: tempFile })
    parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.success).toBe(true)
    expect(parsedResult.isDirty).toBe(true)

    // 4. Test after saving (not dirty anymore)
    await nvim.command('w')
    result = await checkDocumentDirtyHandler({ filePath: tempFile })
    parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.success).toBe(true)
    expect(parsedResult.isDirty).toBe(false)
  } finally {
    // Clean up the created file
    await rm(tempFile)
  }
})

test('openFile', async () => {
  connectNewNeovim()

  const tempFile1 = path.join(os.tmpdir(), `test-openfile-1-${Date.now()}.txt`)
  await writeFile(tempFile1, 'file 1')
  const tempFile2 = path.join(os.tmpdir(), `test-openfile-2-${Date.now()}.txt`)
  await writeFile(tempFile2, 'file 2')

  try {
    // Open file1156 1, should become active
    let result = await openFileHandler({ filePath: tempFile1, makeFrontmost: true, startText: '', endText: '' })
    expect(result.content[0].text).toBe(`Opened file: ${tempFile1}`)
    let currentBuf = await nvim.buffer
    let currentName = await currentBuf.name
    expect(currentName).toBe(tempFile1)

    // Open file 2 in the background
    result = await openFileHandler({ filePath: tempFile2, makeFrontmost: false, startText: '', endText: '' })
    const parsedResult = JSON.parse(result.content[0].text)
    expect(parsedResult.success).toBe(true)
    expect(parsedResult.filePath).toBe(tempFile2)

    // Check that file 2 is listed in buffers
    const buffers = await nvim.buffers
    let found = false
    for (const buf of buffers) {
      if (!buf) continue
      const name = await buf.name
      if (name === tempFile2) {
        found = true
        break
      }
    }
    expect(found).toBe(true)
  } finally {
    await rm(tempFile1)
    await rm(tempFile2)
  }
})
