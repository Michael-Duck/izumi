import { describe, it, expect } from 'vitest'
import { parseNode, parsePresentation, nodeStyle, resolveRow, visibleNode } from './presentation'

describe('theme presentation contract', () => {
  it('composes new layouts from primitives with bounded styles', () => {
    const node = parseNode({ type: 'grid', style: { columns: 2, gap: 24 }, children: [{ type: 'text', field: 'title', style: { color: 'theme' } }, { type: 'artwork', artwork: 'poster' }] })
    expect(nodeStyle(node)).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(nodeStyle(node.children![0])).toContain('color:hsl(var(--theme))')
  })
  it.each([
    { type: 'script', text: 'alert(1)' },
    { type: 'text', style: { background: 'url(https://example.test)' } },
    { type: 'text', style: { fontSize: 10000 } },
    { type: 'text', onclick: 'play()' },
    { type: 'action', action: 'invoke' },
    { type: 'artwork', artwork: 'https://example.test/image' },
  ])('rejects unsupported or executable presentation input %#', value => expect(() => parseNode(value)).toThrow())
  it('rejects nested card actions and excessive template depth or size', () => {
    expect(() => parsePresentation({ rows: { defaults: { card: { type: 'action', action: 'play' } } } })).toThrow('nested actions')
    expect(() => parseNode({ type: 'stack', children: Array.from({ length: 100 }, () => ({ type: 'text', text: 'large' })) })).toThrow('complex')
    let node: unknown = { type: 'text', text: 'deep' }
    for (let i = 0; i < 10; i++) node = { type: 'stack', children: [node] }
    expect(() => parseNode(node)).toThrow('complex')
  })
  it('only shows a top-ten mark when host rank data qualifies', () => {
    const node = parseNode({ type: 'text', text: 'TOP 10', when: { field: 'rankPosition', atMost: 10 } })
    expect(visibleNode(node, { rankPosition: 1 })).toBe(true)
    expect(visibleNode(node, { rankPosition: 10 })).toBe(true)
    for (const model of [{}, { rankPosition: 11 }, { rankPosition: 0 }, { rankPosition: '1' }]) expect(visibleNode(node, model)).toBe(false)
  })
  it('resolves global, semantic row, and exact row preferences in order', () => {
    const layout = parsePresentation({ rows: { defaults: { width: 128, layout: 'grid' }, byId: { continue: { width: 264, layout: 'carousel' }, 'merged:continue': { gap: 24 } } } })
    expect(resolveRow(layout, 'merged:continue')).toEqual({ width: 264, layout: 'carousel', gap: 24 })
    expect(resolveRow(layout, 'merged:popular')).toEqual({ width: 128, layout: 'grid' })
    expect(resolveRow(undefined)).toEqual({})
  })
})
