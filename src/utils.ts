import { Range } from './range.js'
import { Position } from './position.js'
import { DataToken } from './datatoken.js'
import { Interval } from './interval.js'
import { Event } from './event.js'


export const toTree = (range: Range): { name: string, children: any[] } => {
  return {
    name: range instanceof Interval ? range.name : range.text,
    children: range instanceof Interval ? Array.from(range.children()).map(child => toTree(child)) : []
  }
}

export const essentials = (range: Range): any => {
  if (!(range instanceof Interval)) return range.text
  return [
    range.name,
    range.metadata,
    Array.from(range.children()).map(r => essentials(r))
  ]
}

export const descendants = (range: Range, filter: (range: Range) => boolean) => {
  const all: Range[] = []
  function search(node: Range) {
    if (filter(node)) all.push(node)
    else if (node instanceof Interval) Array.from(node.children()).forEach(search)
  }
  search(range)
  return all
}

export const filter = (range: Range, condition: (range: Range) => boolean) => {
  const all: Range[] = []
  function search(node: Range) {
    if (condition(node)) all.push(node)
    if (node instanceof Interval) Array.from(node.children()).forEach(search)
  }
  search(range)
  return all
}

export const smooth = (siblings: Range[], fn: (pos: Position) => Interval, filter: (range: Range) => boolean) => {
  const all: Range[] = []
  let start: Position | undefined
  let accum = ''

  function search(node: Range) {
    if (node instanceof DataToken) accum += node.text
    else if (filter(node)) {
      const ival = fn(start!)
      ival.appendChild(new DataToken(start!, accum))
      accum = ''
      all.push(ival)
      all.push(node)
      start = node.end
    } else if (node instanceof Interval) {
      Array.from(node.children()).forEach(search)
    }
  }

  for (const sibling of siblings) {
    if (start === undefined) start = sibling.start
    search(sibling)
  }

  if (accum.length > 0) {
    const ival = fn(start!)
    ival.appendChild(new DataToken(start!, accum))
    accum = ''
    all.push(ival)
    start = ival.end
  }

  return all
}

export interface RangeBuilder {
  build(start?: Position): Range
}

export class IntervalBuilder implements RangeBuilder {

  children: RangeBuilder[]

  constructor(public name: string, public metadata: any, ...children: RangeBuilder[]) {
    this.children = children
  }

  build(start?: Position): Range {
    if (start === undefined) start = Position.absolute(0)
    const interval = new Interval(start, this.name, this.metadata)
    let lastPosition = interval.start
    for (const range of this.children) {
      const nextInterval = range.build(lastPosition)
      interval.appendChild(nextInterval as Range)
      lastPosition = nextInterval.end
    }
    return interval
  }
}

export class TokenBuilder implements RangeBuilder {
  constructor(public content: string) {}
  build(start?: Position): Range {
    return new DataToken(start ?? Position.absolute(0), this.content)
  }
}

export const interval = (name: string, metadata: any, ...ranges: RangeBuilder[]) => {
  return new IntervalBuilder(name, metadata, ...ranges)
}

export const token = (content: string) => {
  return new TokenBuilder(content)
}

export const tokenstring = (data: any): string => {
  if (Event.describes(data)) {
    const event = data as Event
    return `EVENT [${event.name}] ${event.kind} ${event.position}`
  } else {
    return `DATA [${data.text ?? data._text}] ${(data.start?.get?.() ?? data._start?.position)}`
  }
}
