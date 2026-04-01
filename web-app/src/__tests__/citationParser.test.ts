import { describe, expect, it } from 'vitest'
import {
    mergeCitationMetadata,
    parseCitations,
    replaceCitationsWithPlaceholders,
    stripCitations,
} from '../utils/citationParser'

describe('citationParser', () => {
    it('parses chunk-level citation markers', () => {
        const text = '答案{{cite:1|值班流程|chk_001|src_001|6-7|先检索再展开上下文|}}。'
        const citations = parseCitations(text)

        expect(citations).toEqual([
            {
                index: 1,
                title: '值班流程',
                documentId: null,
                chunkId: 'chk_001',
                sourceId: 'src_001',
                pageLabel: '6-7',
                snippet: '先检索再展开上下文',
                url: null,
            },
        ])
    })

    it('replaces citations with markdown placeholders', () => {
        const text = '步骤说明{{cite:2|处理步骤|chk_010|src_001|9|命中不足时继续检索|}}。'
        expect(replaceCitationsWithPlaceholders(text)).toContain('[CITE_1](#cite-1)')
    })

    it('parses shorthand chunk citations', () => {
        const text = '答案{{cite:chk_001}}补充{{cite:chk_002}}。'
        const citations = parseCitations(text)

        expect(citations).toEqual([
            {
                index: 1,
                title: 'chk_001',
                documentId: null,
                chunkId: 'chk_001',
                sourceId: null,
                pageLabel: null,
                snippet: null,
                url: null,
            },
            {
                index: 2,
                title: 'chk_002',
                documentId: null,
                chunkId: 'chk_002',
                sourceId: null,
                pageLabel: null,
                snippet: null,
                url: null,
            },
        ])
        expect(replaceCitationsWithPlaceholders(text)).toBe('答案[CITE_1](#cite-1)补充[CITE_2](#cite-2)。')
    })

    it('renumbers explicit citations by first appearance within the current answer', () => {
        const text = '结论{{cite:8|文档A|chk_008|src_001|3|证据A|}}补充{{cite:9|文档B|chk_009|src_002|5|证据B|}}。'
        const citations = parseCitations(text)

        expect(citations.map(citation => citation.index)).toEqual([1, 2])
        expect(replaceCitationsWithPlaceholders(text)).toBe('结论[CITE_1](#cite-1)补充[CITE_2](#cite-2)。')
    })

    it('merges shorthand citations with tool metadata', () => {
        const citations = parseCitations('答案{{cite:chk_001}}。')
        const merged = mergeCitationMetadata(citations, [
            {
                index: 1,
                title: '部署方案',
                documentId: null,
                chunkId: 'chk_001',
                sourceId: 'src_ac8da09a7cfd',
                pageLabel: '6-7',
                snippet: '先检索，再按需抓取完整 chunk。',
                url: null,
            },
        ])

        expect(merged).toEqual([
            {
                index: 1,
                title: '部署方案',
                documentId: null,
                chunkId: 'chk_001',
                sourceId: 'src_ac8da09a7cfd',
                pageLabel: '6-7',
                snippet: '先检索，再按需抓取完整 chunk。',
                url: null,
            },
        ])
    })

    it('resolves drifted chunk ids via title, page, and snippet evidence matching', () => {
        const citations = parseCitations('答案{{cite:1|部署方案|chk_drifted|src_guess|6-7|先检索，再按需抓取完整 chunk。|}}。')
        const merged = mergeCitationMetadata(citations, [
            {
                index: 1,
                title: '部署方案',
                documentId: 'doc_001',
                chunkId: 'chk_real_001',
                sourceId: 'src_real',
                pageLabel: '6-7',
                snippet: '先检索，再按需抓取完整 chunk。',
                url: null,
            },
        ])

        expect(merged).toEqual([
            {
                index: 1,
                title: '部署方案',
                documentId: 'doc_001',
                chunkId: 'chk_real_001',
                sourceId: 'src_real',
                pageLabel: '6-7',
                snippet: '先检索，再按需抓取完整 chunk。',
                url: null,
            },
        ])
    })

    it('strips citation markers from text', () => {
        const text = '结论{{cite:1|标题|chk_1|src_1|3|证据|}}。'
        expect(stripCitations(text)).toBe('结论。')
    })
})
