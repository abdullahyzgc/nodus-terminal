export type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string; before?: number; after?: number }
export function diffLines(before: string, after: string): DiffLine[] {
  const original = before.split('\n'); const updated = after.split('\n')
  let prefix = 0
  while (prefix < original.length && prefix < updated.length && original[prefix] === updated[prefix]) prefix++
  let suffix = 0
  while (suffix < original.length - prefix && suffix < updated.length - prefix && original[original.length - suffix - 1] === updated[updated.length - suffix - 1]) suffix++
  const result: DiffLine[] = original.slice(0, prefix).map((text, index) => ({ kind: 'same', text, before: index + 1, after: index + 1 }))
  const left = original.slice(prefix, original.length - suffix); const right = updated.slice(prefix, updated.length - suffix)
  if (left.length * right.length > 1000000 || left.length + right.length > 5000) {
    left.forEach((text, index) => result.push({ kind: 'remove', text, before: prefix + index + 1 }))
    right.forEach((text, index) => result.push({ kind: 'add', text, after: prefix + index + 1 }))
  } else {
    const table = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))
    for (let row = left.length - 1; row >= 0; row--) for (let column = right.length - 1; column >= 0; column--) table[row][column] = left[row] === right[column] ? table[row + 1][column + 1] + 1 : Math.max(table[row + 1][column], table[row][column + 1])
    let row = 0; let column = 0
    while (row < left.length || column < right.length) {
      if (row < left.length && column < right.length && left[row] === right[column]) { result.push({ kind: 'same', text: left[row], before: prefix + row++ + 1, after: prefix + column++ + 1 }); continue }
      if (column < right.length && (row === left.length || table[row][column + 1] > table[row + 1][column])) result.push({ kind: 'add', text: right[column], after: prefix + column++ + 1 })
      else result.push({ kind: 'remove', text: left[row], before: prefix + row++ + 1 })
    }
  }
  for (let index = suffix; index > 0; index--) result.push({ kind: 'same', text: original[original.length - index], before: original.length - index + 1, after: updated.length - index + 1 })
  return result
}
