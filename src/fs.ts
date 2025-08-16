import { stat } from 'fs/promises'

export async function isSameFile(a: string, b: string) {
  if (a === b) {
    return true
  }
  try { 
    const [aStat,bStat] = await Promise.all([stat(a),stat(b)])
    return aStat.dev === bStat.dev && aStat.ino === bStat.ino
  } catch (e) {
    return false
  }
}
