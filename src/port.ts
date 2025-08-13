#!/usr/bin/env node
import { createServer } from 'net'

const srv = createServer()
srv.listen(0, () => {
  const add = srv.address()
  if (add && typeof add === 'object') {
    console.log(add.port)
    process.exit(0)
  }
})
